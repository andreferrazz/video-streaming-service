import {
	S3_ACCESS_KEY_ID,
	S3_BUCKET,
	S3_ENDPOINT,
	S3_FORCE_PATH_STYLE,
	S3_REGION,
	S3_SECRET_ACCESS_KEY
} from '$app/env/private';
import { createStorage } from 'shared/storage';

export const storage = createStorage({
	endpoint: S3_ENDPOINT,
	region: S3_REGION,
	bucket: S3_BUCKET,
	accessKeyId: S3_ACCESS_KEY_ID,
	secretAccessKey: S3_SECRET_ACCESS_KEY,
	forcePathStyle: S3_FORCE_PATH_STYLE
});
