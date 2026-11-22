import { mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { and, eq, lt } from 'drizzle-orm';
import {
	adjustStorage,
	createDb,
	reserveStorage,
	setStorage,
	videos,
	type Video
} from 'shared/db';
import {
	StorageFullError,
	abortMultipartUpload,
	createStorage,
	deleteVideoFiles,
	downloadToFile,
	hlsKey,
	isStorageFull,
	legacyPosterKey,
	measureVideoBytes,
	objectExists,
	posterKey,
	sourceKey,
	uploadFile
} from 'shared/storage';
import { config } from './config.ts';
import { POSTER_LARGE, POSTER_SMALL, makePosters, probe, transcode } from './transcode.ts';

const POLL_MS = 2000;
const UPLOAD_CLEANUP_MS = 10 * 60 * 1000;
const UPLOAD_CONCURRENCY = 8;

const db = createDb(config.databaseUrl);
const storage = createStorage(config.storage);

// Set when the process is asked to stop; aborts ffmpeg and ends the loop.
const shutdown = new AbortController();
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
	process.on(signal, () => shutdown.abort());
}

/** Take the oldest queued video, marking it as processing in the same transaction. */
async function claimNext() {
	return db.transaction(async (tx) => {
		const [next] = await tx
			.select()
			.from(videos)
			.where(eq(videos.status, 'queued'))
			.orderBy(videos.createdAt)
			.limit(1)
			.for('update', { skipLocked: true });
		if (!next) return null;

		await tx
			.update(videos)
			.set({ status: 'processing', progress: 0, error: null, updatedAt: new Date() })
			.where(eq(videos.id, next.id));
		return next;
	});
}

function contentType(file: string) {
	if (file.endsWith('.m3u8')) return 'application/vnd.apple.mpegurl';
	if (file.endsWith('.ts')) return 'video/mp2t';
	return 'application/octet-stream';
}

async function uploadHls(videoId: string, outDir: string) {
	const entries = await readdir(outDir, { recursive: true, withFileTypes: true });
	const files = entries
		.filter((entry) => entry.isFile() && !entry.name.startsWith('poster'))
		.map((entry) => join(entry.parentPath, entry.name));

	// A few uploads at a time: faster than one by one, without flooding the storage.
	const queue = [...files];
	await Promise.all(
		Array.from({ length: UPLOAD_CONCURRENCY }, async () => {
			for (let file = queue.pop(); file; file = queue.pop()) {
				const key = hlsKey(videoId, relative(outDir, file).replaceAll('\\', '/'));
				await uploadFile(storage, key, file, contentType(file));
			}
		})
	);

	await uploadPosters(videoId, outDir);
}

async function uploadPosters(videoId: string, dir: string) {
	await uploadFile(storage, posterKey(videoId, 'large'), join(dir, POSTER_LARGE), 'image/webp');
	await uploadFile(storage, posterKey(videoId, 'small'), join(dir, POSTER_SMALL), 'image/webp');
}

/**
 * Videos processed before the two WebP poster sizes existed only have a JPEG.
 * Make the new sizes from it, so they do not need transcoding again. Each video
 * is done once; after that this is a quick check per video at startup.
 */
async function backfillPosters() {
	const ready = await db.select({ id: videos.id }).from(videos).where(eq(videos.status, 'ready'));

	for (const { id } of ready) {
		if (shutdown.signal.aborted) return;
		if (await objectExists(storage, posterKey(id, 'small'))) continue;
		if (!(await objectExists(storage, legacyPosterKey(id)))) continue;

		const dir = await mkdtemp(join(tmpdir(), `posters-${id}-`));
		try {
			const original = join(dir, 'original.jpg');
			await downloadToFile(storage, legacyPosterKey(id), original);
			await makePosters(original, dir, 0, shutdown.signal);
			await uploadPosters(id, dir);
			console.log(`made smaller posters for ${id}`);
		} catch (cause) {
			// Not worth stopping the worker for: the site falls back to the JPEG.
			console.error(`could not make posters for ${id}`, cause);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	}
}

/** Total size of every file under a folder, in bytes. */
async function folderBytes(dir: string) {
	const entries = await readdir(dir, { recursive: true, withFileTypes: true });
	const sizes = await Promise.all(
		entries
			.filter((entry) => entry.isFile())
			.map(async (entry) => (await stat(join(entry.parentPath, entry.name))).size)
	);
	return sizes.reduce((sum, size) => sum + size, 0);
}

/**
 * Store the renditions and posters, counting them against the storage limit.
 * Room is set aside first; if storing then fails or is interrupted, whatever
 * was written is removed and the room given back, so the count stays true.
 */
async function storeOutput(videoId: string, outDir: string) {
	const bytes = await folderBytes(outDir);
	if (!(await reserveStorage(db, videoId, bytes, config.storageLimitBytes))) {
		throw new StorageFullError();
	}

	try {
		await uploadHls(videoId, outDir);
	} catch (cause) {
		await deleteVideoFiles(storage, videoId, { keepOriginal: true }).catch((cleanup) =>
			console.error(`could not remove partial output of ${videoId}`, cleanup)
		);
		await adjustStorage(db, videoId, -bytes);
		throw cause;
	}
}

async function processVideo(video: Video) {
	const workDir = await mkdtemp(join(tmpdir(), `video-${video.id}-`));
	const input = join(workDir, 'source');
	const outDir = join(workDir, 'out');

	try {
		await downloadToFile(storage, sourceKey(video.id), input);
		const source = await probe(input, shutdown.signal);

		let lastSaved = 0;
		await transcode(input, outDir, source, shutdown.signal, (percent) => {
			// Saving on every ffmpeg report would be hundreds of writes; once a second is plenty.
			if (shutdown.signal.aborted || Date.now() - lastSaved < 1000) return;
			lastSaved = Date.now();
			db.update(videos)
				.set({ progress: percent })
				.where(eq(videos.id, video.id))
				.catch((cause) => console.error('could not save progress', cause));
		});

		await storeOutput(video.id, outDir);

		await db
			.update(videos)
			.set({
				status: 'ready',
				progress: 100,
				width: source.width,
				height: source.height,
				durationSeconds: Math.round(source.durationSeconds),
				updatedAt: new Date()
			})
			.where(eq(videos.id, video.id));
		console.log(`ready ${video.id} "${video.title}"`);
	} catch (cause) {
		if (shutdown.signal.aborted) {
			// Interrupted, not broken: put it back so the next start picks it up.
			await db
				.update(videos)
				.set({ status: 'queued', progress: 0, updatedAt: new Date() })
				.where(eq(videos.id, video.id));
			console.log(`requeued ${video.id}`);
			return;
		}

		const message = isStorageFull(cause)
			? 'Storage is full. Delete some videos to make room, then try again.'
			: cause instanceof Error
				? cause.message
				: String(cause);
		await db
			.update(videos)
			.set({ status: 'failed', error: message.slice(0, 1000), updatedAt: new Date() })
			.where(eq(videos.id, video.id));
		console.error(`failed ${video.id}: ${message}`);
	} finally {
		await rm(workDir, { recursive: true, force: true });
	}
}

/**
 * Videos stored before the app kept count have nothing recorded. Measure what
 * each really holds, once. A video that holds nothing is simply checked again
 * next time, which costs a few quick requests.
 */
async function backfillStoredBytes() {
	const uncounted = await db
		.select({ id: videos.id, status: videos.status })
		.from(videos)
		.where(eq(videos.storedBytes, 0));

	for (const { id, status } of uncounted) {
		if (shutdown.signal.aborted) return;
		// These are being written right now and are counted as they go.
		if (status === 'uploading' || status === 'processing') continue;

		try {
			const bytes = await measureVideoBytes(storage, id);
			if (bytes > 0) {
				await adjustStorage(db, id, bytes);
				console.log(`counted ${bytes} stored bytes for ${id}`);
			}
		} catch (cause) {
			console.error(`could not measure ${id}`, cause);
		}
	}
}

/**
 * An upload that stopped partway keeps its parts in storage and its room
 * reserved. If nothing has happened to it for a while, nobody is coming back:
 * discard the parts and remove the row, which releases the room.
 */
async function removeAbandonedUploads() {
	const abandoned = await db
		.select({ id: videos.id, uploadId: videos.uploadId })
		.from(videos)
		.where(
			and(
				eq(videos.status, 'uploading'),
				lt(videos.updatedAt, new Date(Date.now() - config.uploadExpiryMs))
			)
		);

	for (const { id, uploadId } of abandoned) {
		try {
			if (uploadId) await abortMultipartUpload(storage, sourceKey(id), uploadId);
			await db.delete(videos).where(and(eq(videos.id, id), eq(videos.status, 'uploading')));
			console.log(`removed abandoned upload ${id}`);
		} catch (cause) {
			console.error(`could not remove abandoned upload ${id}`, cause);
		}
	}
}

// A video still marked as processing at startup belongs to a worker that died. Run it again.
// This assumes a single worker; with several, each would steal the others' jobs here.
const stale = await db
	.update(videos)
	.set({ status: 'queued', progress: 0, updatedAt: new Date() })
	.where(eq(videos.status, 'processing'))
	.returning({ id: videos.id });

// That worker may have died after reserving room, or after storing some of the
// renditions. Remove what it left and count again from what is really there,
// so the next attempt starts from a true figure.
for (const { id } of stale) {
	await deleteVideoFiles(storage, id, { keepOriginal: true });
	await setStorage(db, id, await measureVideoBytes(storage, id));
}
if (stale.length > 0) console.log(`requeued ${stale.length} interrupted video(s)`);

console.log('worker started');

await backfillPosters();
await backfillStoredBytes();

let lastUploadCleanup = 0;

while (!shutdown.signal.aborted) {
	if (Date.now() - lastUploadCleanup > UPLOAD_CLEANUP_MS) {
		lastUploadCleanup = Date.now();
		await removeAbandonedUploads().catch((cause) => console.error('upload cleanup failed', cause));
	}

	const video = await claimNext();
	if (video) {
		console.log(`processing ${video.id} "${video.title}"`);
		await processVideo(video);
	} else {
		await sleep(POLL_MS, undefined, { signal: shutdown.signal }).catch(() => {});
	}
}

await db.$client.end();
console.log('worker stopped');
