import { createWriteStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
	DeleteObjectCommand,
	GetObjectCommand,
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
}

export function createStorage(config: StorageConfig) {
	const client = new S3Client({
		endpoint: config.endpoint,
		region: config.region,
		credentials: {
			accessKeyId: config.accessKeyId,
			secretAccessKey: config.secretAccessKey
		},
		// Garage serves buckets as http://host/bucket, not http://bucket.host.
		forcePathStyle: true
	});

	return { client, bucket: config.bucket };
}

export type Storage = ReturnType<typeof createStorage>;

/** True when storage refused a write because the bucket has reached its size limit. */
export function isStorageFull(cause: unknown) {
	return cause instanceof Error && /quota is reached/i.test(cause.message);
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

export function posterKey(videoId: string) {
	return `posters/${videoId}.jpg`;
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

/** Remove everything stored for a video: the original, the poster and all HLS files. */
export async function deleteVideoFiles(storage: Storage, videoId: string) {
	const keys = [sourceKey(videoId), posterKey(videoId)];

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
			if (object.Key) keys.push(object.Key);
		}
		token = page.NextContinuationToken;
	} while (token);

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
