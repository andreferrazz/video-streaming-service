function required(name: string) {
	const value = process.env[name];
	if (!value) throw new Error(`Missing environment variable ${name}`);
	return value;
}

export const config = {
	databaseUrl: required('DATABASE_URL'),
	storage: {
		endpoint: required('S3_ENDPOINT'),
		region: required('S3_REGION'),
		bucket: required('S3_BUCKET'),
		accessKeyId: required('S3_ACCESS_KEY_ID'),
		secretAccessKey: required('S3_SECRET_ACCESS_KEY')
	}
};
