import { defineEnvVars } from '@sveltejs/kit/env';

export const variables = defineEnvVars({
	DATABASE_URL: {
		description: 'Postgres connection string'
	},
	S3_ENDPOINT: {
		description: 'URL of the S3-compatible object storage'
	},
	S3_REGION: {
		description: 'Region name the storage expects'
	},
	S3_BUCKET: {
		description: 'Bucket that holds uploads and transcoded video'
	},
	S3_PUBLIC_ENDPOINT: {
		description:
			'The address browsers use to reach storage, if different from S3_ENDPOINT. Signed upload addresses are made for it',
		schema: (value) => value || undefined
	},
	S3_FORCE_PATH_STYLE: {
		description: 'Address the bucket as host/bucket (true, the default) or bucket.host (false)',
		schema: (value) => value !== 'false'
	},
	S3_ACCESS_KEY_ID: {
		description: 'Storage access key id'
	},
	S3_SECRET_ACCESS_KEY: {
		description: 'Storage secret key'
	},
	STORAGE_LIMIT_GB: {
		description: 'The most all videos together may hold in storage, in gigabytes (default 10)',
		schema: (value) => {
			const gigabytes = value === undefined || value === '' ? 10 : Number(value);
			if (!Number.isFinite(gigabytes) || gigabytes <= 0) {
				throw new Error('STORAGE_LIMIT_GB must be a positive number');
			}
			return gigabytes;
		}
	},
	UPLOAD_MAX_GB: {
		description: 'The largest single file accepted, in gigabytes (default 20)',
		schema: (value) => {
			const gigabytes = value === undefined || value === '' ? 20 : Number(value);
			if (!Number.isFinite(gigabytes) || gigabytes <= 0) {
				throw new Error('UPLOAD_MAX_GB must be a positive number');
			}
			return gigabytes;
		}
	},
	ORIGIN: {
		description:
			'Public address of the site. Pages from it are allowed to upload to storage; defaults to the local dev server',
		schema: (value) => value || 'http://localhost:5173'
	},
	ADMIN_PASSWORD: {
		description: 'Password for the admin area'
	},
	SESSION_SECRET: {
		description: 'Key used to sign the admin session cookie',
		schema: (value) => {
			if (!value || value.length < 32) {
				throw new Error('SESSION_SECRET must be at least 32 characters');
			}
			return value;
		}
	}
});
