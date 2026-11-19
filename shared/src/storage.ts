import { S3Client } from '@aws-sdk/client-s3';
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
