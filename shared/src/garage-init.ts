// Prepares Garage for the app through its admin API: gives the single node its
// storage role, creates the bucket and registers the app's access key.
// It runs on every deploy, before the web app and the worker start, and skips
// each step that is already done, so only the first run changes anything.

// When the stack is pointed at storage other than the bundled Garage, there is
// nothing here to prepare: the bucket and its key are created at that provider.
if (process.env.EXTERNAL_S3_ENDPOINT) {
	console.log('external storage is configured; skipping Garage setup');
	process.exit(0);
}

function required(name: string) {
	const value = process.env[name];
	if (!value) throw new Error(`Missing environment variable ${name}`);
	return value;
}

const adminUrl = required('GARAGE_ADMIN_URL');
const adminToken = required('GARAGE_ADMIN_TOKEN');
const bucketName = required('S3_BUCKET');
const accessKeyId = required('S3_ACCESS_KEY_ID');
const secretAccessKey = required('S3_SECRET_ACCESS_KEY');
// How much disk Garage may use on this node. It is only applied the first time.
const capacityBytes = Number(process.env.GARAGE_CAPACITY_GB ?? 100) * 1_000_000_000;
// The most the bucket may hold. Unlike the capacity above this is enforced:
// Garage refuses uploads that would go past it. Applied on every deploy.
const maxSizeBytes = Number(process.env.GARAGE_MAX_SIZE_GB ?? 10) * 1_000_000_000;

/** Call the admin API. Returns null when the thing asked for does not exist. */
async function admin<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T | null> {
	const response = await fetch(`${adminUrl}/v2/${path}`, {
		method,
		headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' },
		body: body === undefined ? undefined : JSON.stringify(body)
	});

	if (response.status === 404) return null;
	if (!response.ok) {
		throw new Error(`${method} ${path} failed with ${response.status}: ${await response.text()}`);
	}
	return (await response.json()) as T;
}

interface ClusterStatus {
	nodes: { id: string; role: unknown | null }[];
}
interface Layout {
	version: number;
}
interface Bucket {
	id: string;
	quotas: { maxSize: number | null; maxObjects: number | null };
	keys: { accessKeyId: string; permissions: { read: boolean; write: boolean; owner: boolean } }[];
}

/** Garage takes a moment to accept connections after its container starts. */
async function waitForGarage() {
	for (let attempt = 1; ; attempt++) {
		try {
			const status = await admin<ClusterStatus>('GET', 'GetClusterStatus');
			if (status) return status;
		} catch (cause) {
			if (attempt >= 30) throw cause;
		}
		await new Promise((resolve) => setTimeout(resolve, 1000));
	}
}

const status = await waitForGarage();
if (status.nodes.length !== 1) {
	throw new Error(`Expected a single Garage node, found ${status.nodes.length}`);
}
const [node] = status.nodes;

if (node.role === null) {
	const layout = await admin<Layout>('GET', 'GetClusterLayout');
	await admin('POST', 'UpdateClusterLayout', {
		roles: [{ id: node.id, zone: 'dc1', capacity: capacityBytes, tags: [] }]
	});
	await admin('POST', 'ApplyClusterLayout', { version: (layout?.version ?? 0) + 1 });
	console.log(`assigned ${capacityBytes / 1_000_000_000} GB to the node`);
} else {
	console.log('node already has its storage role');
}

let bucket = await admin<Bucket>('GET', `GetBucketInfo?globalAlias=${bucketName}`);
if (!bucket) {
	bucket = await admin<Bucket>('POST', 'CreateBucket', { globalAlias: bucketName });
	console.log(`created bucket ${bucketName}`);
} else {
	console.log(`bucket ${bucketName} already exists`);
}
if (!bucket) throw new Error(`Could not create bucket ${bucketName}`);

// The key pair is chosen ahead of time and imported, so the apps can be
// configured with it before Garage has ever started.
if (!(await admin('GET', `GetKeyInfo?id=${accessKeyId}`))) {
	await admin('POST', 'ImportKey', { accessKeyId, secretAccessKey, name: 'app' });
	console.log('imported the access key');
} else {
	console.log('access key already exists');
}

const granted = bucket.keys.find((key) => key.accessKeyId === accessKeyId)?.permissions;
if (!granted?.read || !granted.write || !granted.owner) {
	await admin('POST', 'AllowBucketKey', {
		bucketId: bucket.id,
		accessKeyId,
		permissions: { read: true, write: true, owner: true }
	});
	console.log('granted the key access to the bucket');
} else {
	console.log('key already has access to the bucket');
}

if (bucket.quotas.maxSize !== maxSizeBytes) {
	await admin('POST', `UpdateBucket?id=${bucket.id}`, {
		quotas: { maxSize: maxSizeBytes, maxObjects: bucket.quotas.maxObjects }
	});
	console.log(`set the bucket size limit to ${maxSizeBytes / 1_000_000_000} GB`);
} else {
	console.log('bucket size limit already set');
}

console.log('garage is ready');
