function required(name: string) {
	const value = process.env[name];
	if (!value) throw new Error(`Missing environment variable ${name}`);
	return value;
}

const storageLimitGb = Number(process.env.STORAGE_LIMIT_GB || 10);
if (!Number.isFinite(storageLimitGb) || storageLimitGb <= 0) {
	throw new Error('STORAGE_LIMIT_GB must be a positive number');
}

export const config = {
	databaseUrl: required('DATABASE_URL'),
	/** The most all videos together may hold in storage, in bytes. */
	storageLimitBytes: storageLimitGb * 1_000_000_000,
	storage: {
		endpoint: required('S3_ENDPOINT'),
		region: required('S3_REGION'),
		bucket: required('S3_BUCKET'),
		accessKeyId: required('S3_ACCESS_KEY_ID'),
		secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
		// Optional: path-style addressing unless explicitly turned off.
		forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== 'false'
	}
};
