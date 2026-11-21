import { createWriteStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
	DeleteObjectCommand,
	GetObjectCommand,
	HeadObjectCommand,
	ListObjectsV2Command,
	PutObjectCommand,
	S3Client
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';

export interface StorageConfig {
	endpoint: string;
	region: string;
	bucket: string;
	accessKeyId: string;
	secretAccessKey: string;
	/**
	 * How the bucket is addressed: true for http://host/bucket, false for
	 * http://bucket.host. Garage and most self-hosted servers need true; some
	 * hosted providers prefer false.
	 */
	forcePathStyle: boolean;
}

export function createStorage(config: StorageConfig) {
	const client = new S3Client({
		endpoint: config.endpoint,
		region: config.region,
		credentials: {
			accessKeyId: config.accessKeyId,
			secretAccessKey: config.secretAccessKey
		},
		forcePathStyle: config.forcePathStyle
	});

	return { client, bucket: config.bucket };
}

export type Storage = ReturnType<typeof createStorage>;

/** True when storage refused a write because the bucket has reached its size limit. */
export function isStorageFull(cause: unknown) {
	// Our own limit, or as a backstop the wording Garage uses for its bucket quota.
	return (
		cause instanceof StorageFullError ||
		(cause instanceof Error && /quota is reached/i.test(cause.message))
	);
}

/** Thrown when storing something would take the total past the configured limit. */
export class StorageFullError extends Error {
	constructor() {
		super('Storage is full.');
		this.name = 'StorageFullError';
	}
}

/** Where the original upload of a video is kept. */
export function sourceKey(videoId: string) {
	return `sources/${videoId}`;
}

/**
 * Stream a body of unknown length into the bucket. The upload is split into
 * parts, so memory use stays flat however large the file is.
 */
export async function uploadStream(
	storage: Storage,
	key: string,
	body: ReadableStream<Uint8Array>,
	contentType: string
) {
	const upload = new Upload({
		client: storage.client,
		params: { Bucket: storage.bucket, Key: key, Body: body, ContentType: contentType },
		partSize: 16 * 1024 * 1024,
		queueSize: 2
	});

	await upload.done();
}

/** Folder that holds the HLS playlists and segments of a video. */
export function hlsKey(videoId: string, file: string) {
	return `hls/${videoId}/${file}`;
}

/**
 * Posters come in two sizes: large for the player and the home page's featured
 * video, small for cards and thumbnails.
 */
export function posterKey(videoId: string, size: 'large' | 'small') {
	return size === 'large' ? `posters/${videoId}.webp` : `posters/${videoId}-small.webp`;
}

/** The single JPEG poster made for videos processed before the two WebP sizes existed. */
export function legacyPosterKey(videoId: string) {
	return `posters/${videoId}.jpg`;
}

export async function objectExists(storage: Storage, key: string) {
	try {
		await storage.client.send(new HeadObjectCommand({ Bucket: storage.bucket, Key: key }));
		return true;
	} catch (cause) {
		if (cause instanceof Error && (cause.name === 'NotFound' || cause.name === 'NoSuchKey')) {
			return false;
		}
		throw cause;
	}
}

export async function downloadToFile(storage: Storage, key: string, path: string) {
	const response = await storage.client.send(
		new GetObjectCommand({ Bucket: storage.bucket, Key: key })
	);
	if (!response.Body) throw new Error(`Object ${key} has no body`);
	await pipeline(response.Body as Readable, createWriteStream(path));
}

export async function uploadFile(storage: Storage, key: string, path: string, contentType: string) {
	// Segments are a few megabytes each, so reading one into memory is fine.
	const body = await readFile(path);
	await storage.client.send(
		new PutObjectCommand({ Bucket: storage.bucket, Key: key, Body: body, ContentType: contentType })
	);
}

/**
 * Open an object for reading as a web stream, or return null if it does not
 * exist. Used to pass playlists and segments straight through to the browser.
 */
export async function openObject(storage: Storage, key: string) {
	try {
		const response = await storage.client.send(
			new GetObjectCommand({ Bucket: storage.bucket, Key: key })
		);
		if (!response.Body) return null;

		return {
			body: response.Body.transformToWebStream(),
			contentType: response.ContentType ?? 'application/octet-stream',
			contentLength: response.ContentLength
		};
	} catch (cause) {
		if (cause instanceof Error && cause.name === 'NoSuchKey') return null;
		throw cause;
	}
}

/** Every HLS file of a video, with its size. */
async function listHls(storage: Storage, videoId: string) {
	const objects: { key: string; size: number }[] = [];

	// Listing returns at most 1000 keys at a time, so keep asking until there are no more.
	let token: string | undefined;
	do {
		const page = await storage.client.send(
			new ListObjectsV2Command({
				Bucket: storage.bucket,
				Prefix: hlsKey(videoId, ''),
				ContinuationToken: token
			})
		);
		for (const object of page.Contents ?? []) {
			if (object.Key) objects.push({ key: object.Key, size: object.Size ?? 0 });
		}
		token = page.NextContinuationToken;
	} while (token);

	return objects;
}

/** Size of one object in bytes, or 0 if it does not exist. */
async function objectSize(storage: Storage, key: string) {
	try {
		const head = await storage.client.send(
			new HeadObjectCommand({ Bucket: storage.bucket, Key: key })
		);
		return head.ContentLength ?? 0;
	} catch (cause) {
		if (cause instanceof Error && (cause.name === 'NotFound' || cause.name === 'NoSuchKey')) {
			return 0;
		}
		throw cause;
	}
}

/**
 * How many bytes a video really holds in the bucket. The app normally keeps
 * count as it goes; this measures, for videos stored before it did.
 */
export async function measureVideoBytes(storage: Storage, videoId: string) {
	const singles = await Promise.all(
		[
			sourceKey(videoId),
			posterKey(videoId, 'large'),
			posterKey(videoId, 'small'),
			legacyPosterKey(videoId)
		].map((key) => objectSize(storage, key))
	);
	const hls = await listHls(storage, videoId);

	return [...singles, ...hls.map((object) => object.size)].reduce((sum, size) => sum + size, 0);
}

/** Remove everything stored for a video: the original, the posters and all HLS files. */
export async function deleteVideoFiles(
	storage: Storage,
	videoId: string,
	// Pass { keepOriginal: true } to remove only what the worker produced.
	options: { keepOriginal?: boolean } = {}
) {
	const keys = [
		posterKey(videoId, 'large'),
		posterKey(videoId, 'small'),
		legacyPosterKey(videoId),
		...(await listHls(storage, videoId)).map((object) => object.key)
	];
	if (!options.keepOriginal) keys.push(sourceKey(videoId));

	// Deleting a key that does not exist is not an error, so missing files are fine.
	const queue = [...keys];
	await Promise.all(
		Array.from({ length: 8 }, async () => {
			for (let key = queue.pop(); key; key = queue.pop()) {
				await storage.client.send(new DeleteObjectCommand({ Bucket: storage.bucket, Key: key }));
			}
		})
	);
}
