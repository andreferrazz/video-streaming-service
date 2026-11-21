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
	createStorage,
	deleteVideoFiles,
	downloadToFile,
	hlsKey,
	objectExists,
	openObject,
	posterKey,
	sourceKey,
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
