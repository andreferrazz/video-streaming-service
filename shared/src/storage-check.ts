// Checks that an S3-compatible server supports everything this project asks of
// its storage, by running each storage function against it for real.
//
// It works on a made-up video id, so it is safe to run against a bucket that is
// in use, and it removes everything it wrote.
//
//   pnpm --filter shared storage:check
//
// Settings come from the same S3_* variables the apps use.

import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	abortMultipartUpload,
	allowBrowserUploads,
	completeMultipartUpload,
	createStorage,
	deleteVideoFiles,
	downloadToFile,
	forbidBrowserUploads,
	getBrowserUploadOrigins,
	hlsKey,
	listUploadedParts,
	objectExists,
	openObject,
	posterKey,
	signPartUpload,
	sourceKey,
	startMultipartUpload,
	uploadFile,
	uploadStream
} from './storage.ts';

function required(name: string) {
	const value = process.env[name];
	if (!value) throw new Error(`Missing environment variable ${name}`);
	return value;
}

const storage = createStorage({
	endpoint: required('S3_ENDPOINT'),
	region: required('S3_REGION'),
	bucket: required('S3_BUCKET'),
	accessKeyId: required('S3_ACCESS_KEY_ID'),
	secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
	forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== 'false'
});

const videoId = randomUUID();
const dir = await mkdtemp(join(tmpdir(), 'storage-check-'));
let failures = 0;

async function check(name: string, run: () => Promise<void>) {
	try {
		await run();
		console.log(`ok    ${name}`);
	} catch (cause) {
		failures++;
		console.log(`FAIL  ${name}\n      ${cause instanceof Error ? cause.message : cause}`);
	}
}

function expect(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

/** Predictable bytes, so a round trip can be compared without keeping a copy. */
function pattern(size: number) {
	const bytes = new Uint8Array(size);
	for (let i = 0; i < size; i++) bytes[i] = (i * 31 + (i >> 8)) & 0xff;
	return bytes;
}

async function readAll(stream: ReadableStream<Uint8Array>) {
	return new Uint8Array(await new Response(stream).arrayBuffer());
}

function same(a: Uint8Array, b: Uint8Array) {
	return a.length === b.length && Buffer.compare(a, b) === 0;
}

console.log(`checking ${process.env.S3_ENDPOINT}, bucket ${process.env.S3_BUCKET}\n`);

try {
	// 40 MB is larger than one 16 MB part, so this takes the multipart path that
	// real uploads use.
	const large = pattern(40 * 1024 * 1024);

	await check('stream a large upload in parts', async () => {
		const body = new ReadableStream<Uint8Array>({
			start(controller) {
				// Hand it over in small pieces, as a browser upload arrives.
				for (let at = 0; at < large.length; at += 256 * 1024) {
					controller.enqueue(large.subarray(at, at + 256 * 1024));
				}
				controller.close();
			}
		});
		await uploadStream(storage, sourceKey(videoId), body, 'video/mp4');
	});

	await check('see that an object exists', async () => {
		expect(await objectExists(storage, sourceKey(videoId)), 'the uploaded object was not found');
	});

	await check('see that a missing object does not exist', async () => {
		expect(!(await objectExists(storage, sourceKey(randomUUID()))), 'a missing object was reported');
	});

	await check('download to a file, byte for byte', async () => {
		const path = join(dir, 'download');
		await downloadToFile(storage, sourceKey(videoId), path);
		expect(same(await readFile(path), large), 'the downloaded bytes differ from what was uploaded');
	});

	const small = pattern(70_000);
	await writeFile(join(dir, 'small'), small);

	await check('upload a file with its content type', async () => {
		await uploadFile(storage, hlsKey(videoId, '720p/index.m3u8'), join(dir, 'small'), 'application/vnd.apple.mpegurl');
		await uploadFile(storage, posterKey(videoId, 'large'), join(dir, 'small'), 'image/webp');
		await uploadFile(storage, posterKey(videoId, 'small'), join(dir, 'small'), 'image/webp');
	});

	await check('open an object as a stream, with type and length', async () => {
		const object = await openObject(storage, hlsKey(videoId, '720p/index.m3u8'));
		expect(object, 'the object could not be opened');
		expect(object.contentType === 'application/vnd.apple.mpegurl', `content type came back as ${object.contentType}`);
		expect(object.contentLength === small.length, `content length came back as ${object.contentLength}`);
		expect(same(await readAll(object.body), small), 'the streamed bytes differ from what was uploaded');
	});

	await check('get nothing, not an error, for a missing object', async () => {
		expect((await openObject(storage, hlsKey(videoId, 'missing.m3u8'))) === null, 'expected null');
	});

	// ---- Direct uploads: what a browser does, done here with plain fetch and no credentials ----

	const directId = randomUUID();
	const partBytes = [pattern(5 * 1024 * 1024), pattern(5 * 1024 * 1024 + 123), pattern(999)];
	let uploadId = '';

	await check('open a multipart upload', async () => {
		uploadId = await startMultipartUpload(storage, sourceKey(directId), 'video/mp4');
		expect(uploadId, 'no upload id came back');
	});

	await check('send parts to signed addresses, without credentials', async () => {
		// Out of order on purpose: a browser sends several at once.
		for (const number of [2, 1, 3]) {
			const url = await signPartUpload(storage, sourceKey(directId), uploadId, number, 300);
			const response = await fetch(url, { method: 'PUT', body: partBytes[number - 1] });
			expect(response.ok, `part ${number} was refused with ${response.status}: ${await response.text()}`);
		}
	});

	await check('refuse a signed address that was altered', async () => {
		const url = await signPartUpload(storage, sourceKey(directId), uploadId, 4, 300);
		const response = await fetch(url.replace('partNumber=4', 'partNumber=5'), {
			method: 'PUT',
			body: 'x'
		});
		expect(!response.ok, 'an altered address was accepted');
	});

	await check('list the parts that arrived, in order, with sizes', async () => {
		const parts = await listUploadedParts(storage, sourceKey(directId), uploadId);
		expect(parts.length === 3, `expected 3 parts, storage reports ${parts.length}`);
		expect(parts.map((part) => part.partNumber).join() === '1,2,3', 'the parts are out of order');
		expect(
			parts.every((part, i) => part.size === partBytes[i].length),
			`sizes came back as ${parts.map((part) => part.size).join()}`
		);
	});

	await check('assemble the parts into one object, byte for byte', async () => {
		const parts = await listUploadedParts(storage, sourceKey(directId), uploadId);
		await completeMultipartUpload(storage, sourceKey(directId), uploadId, parts);

		const object = await openObject(storage, sourceKey(directId));
		expect(object, 'the assembled object could not be opened');
		expect(object.contentType === 'video/mp4', `content type came back as ${object.contentType}`);
		expect(same(await readAll(object.body), Buffer.concat(partBytes)), 'the assembled bytes differ');
	});

	await check('abort an unfinished upload, and again when it is already gone', async () => {
		const key = sourceKey(randomUUID());
		const abandoned = await startMultipartUpload(storage, key, 'video/mp4');
		const url = await signPartUpload(storage, key, abandoned, 1, 300);
		await fetch(url, { method: 'PUT', body: pattern(1000) });

		await abortMultipartUpload(storage, key, abandoned);
		await abortMultipartUpload(storage, key, abandoned);
		expect(!(await objectExists(storage, key)), 'an aborted upload left an object behind');
	});

	await check('allow browser uploads from one origin only', async () => {
		// The bucket may be in real use: put its rules back afterwards.
		const before = await getBrowserUploadOrigins(storage);
		const origin = 'https://storage-check.example';
		const endpoint = required('S3_ENDPOINT').replace(/\/$/, '');
		const preflight = (from: string) =>
			fetch(`${endpoint}/${required('S3_BUCKET')}/${sourceKey(directId)}`, {
				method: 'OPTIONS',
				headers: { origin: from, 'access-control-request-method': 'PUT' }
			});

		try {
			await allowBrowserUploads(storage, [origin]);
			expect((await getBrowserUploadOrigins(storage))?.join() === origin, 'the rules were not stored');

			const allowed = await preflight(origin);
			expect(
				allowed.ok && allowed.headers.get('access-control-allow-origin') === origin,
				`the allowed origin got ${allowed.status}, allow-origin ${allowed.headers.get('access-control-allow-origin')}`
			);

			const other = await preflight('https://somewhere-else.example');
			expect(
				other.headers.get('access-control-allow-origin') !== 'https://somewhere-else.example',
				'another origin was allowed'
			);
		} finally {
			if (before) await allowBrowserUploads(storage, before);
			else await forbidBrowserUploads(storage);
		}
	});

	await deleteVideoFiles(storage, directId).catch(() => {});

	// More than 1000 keys, so the listing has to be read in more than one page.
	const segments = 1100;
	await writeFile(join(dir, 'tiny'), pattern(64));

	await check(`store ${segments} small files under one video`, async () => {
		const queue = Array.from({ length: segments }, (_, i) => i);
		await Promise.all(
			Array.from({ length: 16 }, async () => {
				for (let i = queue.pop(); i !== undefined; i = queue.pop()) {
					const name = `360p/seg_${String(i).padStart(5, '0')}.ts`;
					await uploadFile(storage, hlsKey(videoId, name), join(dir, 'tiny'), 'video/mp2t');
				}
			})
		);
	});

	await check('delete everything stored for the video', async () => {
		await deleteVideoFiles(storage, videoId);
		for (const key of [
			sourceKey(videoId),
			posterKey(videoId, 'large'),
			posterKey(videoId, 'small'),
			hlsKey(videoId, '720p/index.m3u8'),
			hlsKey(videoId, '360p/seg_00000.ts'),
			hlsKey(videoId, `360p/seg_${String(segments - 1).padStart(5, '0')}.ts`)
		]) {
			expect(!(await objectExists(storage, key)), `${key} is still there`);
		}
	});

	await check('delete again when nothing is left', async () => {
		await deleteVideoFiles(storage, videoId);
	});
} finally {
	// Whatever happened above, leave the bucket as it was found.
	await deleteVideoFiles(storage, videoId).catch(() => {});
	await rm(dir, { recursive: true, force: true });
}

console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
