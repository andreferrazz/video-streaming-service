import { createWriteStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
	AbortMultipartUploadCommand,
	CompleteMultipartUploadCommand,
	CreateMultipartUploadCommand,
	DeleteBucketCorsCommand,
	DeleteObjectCommand,
	GetBucketCorsCommand,
	GetObjectCommand,
	HeadObjectCommand,
	ListObjectsV2Command,
	ListPartsCommand,
	PutBucketCorsCommand,
	PutObjectCommand,
	S3Client,
	UploadPartCommand
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

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
	/**
	 * The address browsers use to reach the same storage, when it differs from
	 * `endpoint`. Signed upload addresses are made for this one. Inside a
	 * deployment the apps reach storage by an internal name that a browser cannot.
	 */
	publicEndpoint?: string;
}

export function createStorage(config: StorageConfig) {
	const options = {
		region: config.region,
		credentials: {
			accessKeyId: config.accessKeyId,
			secretAccessKey: config.secretAccessKey
		},
		forcePathStyle: config.forcePathStyle,
		// Only add checksums where S3 demands them. By default the library signs one
		// into every upload address, and a browser sending a part cannot supply it.
		requestChecksumCalculation: 'WHEN_REQUIRED',
		responseChecksumValidation: 'WHEN_REQUIRED'
	} as const;

	const client = new S3Client({ ...options, endpoint: config.endpoint });
	// Used only to make signed addresses; it never sends a request itself.
	const publicClient = new S3Client({
		...options,
		endpoint: config.publicEndpoint ?? config.endpoint
	});

	return { client, publicClient, bucket: config.bucket };
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

// ---------------------------------------------------------------------------
// Direct uploads
//
// A large file is uploaded by the browser straight to storage, in parts. The
// app opens the upload, hands out a signed address per part, and finally asks
// storage what arrived before assembling the file. Nothing here trusts the
// browser's own account of what it sent.
// ---------------------------------------------------------------------------

/** One part of a multipart upload that storage has received. */
export interface UploadedPart {
	partNumber: number;
	size: number;
	etag: string;
}

/** Open a multipart upload and return the id that names it from then on. */
export async function startMultipartUpload(storage: Storage, key: string, contentType: string) {
	const response = await storage.client.send(
		new CreateMultipartUploadCommand({ Bucket: storage.bucket, Key: key, ContentType: contentType })
	);
	if (!response.UploadId) throw new Error(`Storage did not return an upload id for ${key}`);
	return response.UploadId;
}

/**
 * An address a browser can PUT one part to, with no credentials of its own. It
 * is good for that part of that upload only, and only for `expiresInSeconds`.
 */
export async function signPartUpload(
	storage: Storage,
	key: string,
	uploadId: string,
	partNumber: number,
	expiresInSeconds: number
) {
	return getSignedUrl(
		storage.publicClient,
		new UploadPartCommand({
			Bucket: storage.bucket,
			Key: key,
			UploadId: uploadId,
			PartNumber: partNumber
		}),
		{ expiresIn: expiresInSeconds }
	);
}

/** The parts storage holds for an upload, in order. Used to resume and to finish. */
export async function listUploadedParts(storage: Storage, key: string, uploadId: string) {
	const parts: UploadedPart[] = [];

	// Listed at most 1000 at a time; an upload may have up to 10,000 parts.
	let marker: string | undefined;
	do {
		const page = await storage.client.send(
			new ListPartsCommand({
				Bucket: storage.bucket,
				Key: key,
				UploadId: uploadId,
				PartNumberMarker: marker
			})
		);
		for (const part of page.Parts ?? []) {
			if (part.PartNumber && part.ETag) {
				parts.push({ partNumber: part.PartNumber, size: part.Size ?? 0, etag: part.ETag });
			}
		}
		marker = page.IsTruncated ? page.NextPartNumberMarker : undefined;
	} while (marker);

	return parts.sort((a, b) => a.partNumber - b.partNumber);
}

/** Assemble the given parts into the final object. */
export async function completeMultipartUpload(
	storage: Storage,
	key: string,
	uploadId: string,
	parts: UploadedPart[]
) {
	await storage.client.send(
		new CompleteMultipartUploadCommand({
			Bucket: storage.bucket,
			Key: key,
			UploadId: uploadId,
			MultipartUpload: {
				Parts: parts.map((part) => ({ PartNumber: part.partNumber, ETag: part.etag }))
			}
		})
	);
}

/** Give up on an upload and free the parts it had stored. Fine to call twice. */
export async function abortMultipartUpload(storage: Storage, key: string, uploadId: string) {
	try {
		await storage.client.send(
			new AbortMultipartUploadCommand({ Bucket: storage.bucket, Key: key, UploadId: uploadId })
		);
	} catch (cause) {
		if (cause instanceof Error && cause.name === 'NoSuchUpload') return;
		throw cause;
	}
}

/** The origins currently allowed to upload from a browser, or null if none are set. */
export async function getBrowserUploadOrigins(storage: Storage) {
	try {
		const response = await storage.client.send(new GetBucketCorsCommand({ Bucket: storage.bucket }));
		return response.CORSRules?.flatMap((rule) => rule.AllowedOrigins ?? []) ?? null;
	} catch (cause) {
		if (cause instanceof Error && cause.name === 'NoSuchCORSConfiguration') return null;
		throw cause;
	}
}

/**
 * Let pages served from `origins` send parts to the bucket. Browsers refuse a
 * cross-origin upload unless storage says the page's origin is welcome. This
 * replaces whatever rules the bucket had.
 */
export async function allowBrowserUploads(storage: Storage, origins: string[]) {
	await storage.client.send(
		new PutBucketCorsCommand({
			Bucket: storage.bucket,
			CORSConfiguration: {
				CORSRules: [
					{
						AllowedOrigins: origins,
						AllowedMethods: ['PUT'],
						AllowedHeaders: ['*'],
						// The page may read this header, though the app does not rely on it.
						ExposeHeaders: ['ETag'],
						MaxAgeSeconds: 3600
					}
				]
			}
		})
	);
}

/** Remove the bucket's cross-origin rules, so no page may upload from a browser. */
export async function forbidBrowserUploads(storage: Storage) {
	await storage.client.send(new DeleteBucketCorsCommand({ Bucket: storage.bucket }));
}
