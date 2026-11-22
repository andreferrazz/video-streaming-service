import { randomBytes } from 'node:crypto';
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { hostname, tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { and, eq, isNull, lt, or, sql } from 'drizzle-orm';
import {
	createDb,
	releaseStorageAs,
	reserveStorageAs,
	setStorage,
	setStorageIfUncounted,
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

// ---------------------------------------------------------------------------
// Leases
//
// Several workers may run at once, on one machine or many. A worker that takes
// a video writes its own name on it with an expiry time, and keeps pushing that
// time forward while it works. If the worker dies, the time passes and another
// worker takes the video over. Every write a worker makes to a video is
// conditional on its name still being there, so a worker that was only slow,
// and has been replaced, cannot undo its successor's work.
//
// Expiry times are set and compared with the database's clock, never the
// worker's, so machines whose clocks disagree still agree on who owns what.
// ---------------------------------------------------------------------------

/** This worker's name: unique per process, and readable in the database. */
const workerId = `${hostname()}-${process.pid}-${randomBytes(3).toString('hex')}`;

/** A moment `leaseSeconds` from now, by the database's clock. */
const leaseExpiry = sql`now() + make_interval(secs => ${config.leaseSeconds})`;

/** Matches a video only while this worker still holds it. */
function mine(videoId: string) {
	return and(eq(videos.id, videoId), eq(videos.lockedBy, workerId));
}

/** Thrown when this worker finds it no longer holds the video it is working on. */
class LeaseLost extends Error {}

/**
 * Take the oldest video that needs work: one that is queued, or one whose
 * worker has stopped renewing its claim. Returns null when there is nothing.
 */
async function claimNext() {
	return db.transaction(async (tx) => {
		const [next] = await tx
			.select()
			.from(videos)
			.where(
				or(
					eq(videos.status, 'queued'),
					and(
						eq(videos.status, 'processing'),
						// No expiry at all means it was claimed by a version without leases.
						or(isNull(videos.lockedUntil), lt(videos.lockedUntil, sql`now()`))
					)
				)
			)
			.orderBy(videos.createdAt)
			.limit(1)
			// Two workers asking at the same moment are given different rows.
			.for('update', { skipLocked: true });
		if (!next) return null;

		// Its previous worker vanished mid-job, as opposed to it waiting in the queue.
		const takenOver = next.status === 'processing';

		if (next.attempts >= config.maxAttempts) {
			await tx
				.update(videos)
				.set({
					status: 'failed',
					error: `Gave up after ${next.attempts} attempts: the worker stopped each time while processing this video.`,
					lockedBy: null,
					lockedUntil: null,
					updatedAt: new Date()
				})
				.where(eq(videos.id, next.id));
			return { video: next, takenOver, gaveUp: true };
		}

		await tx
			.update(videos)
			.set({
				status: 'processing',
				progress: 0,
				error: null,
				lockedBy: workerId,
				lockedUntil: leaseExpiry,
				attempts: next.attempts + 1,
				updatedAt: new Date()
			})
			.where(eq(videos.id, next.id));
		return { video: next, takenOver, gaveUp: false };
	});
}

function contentType(file: string) {
	if (file.endsWith('.m3u8')) return 'application/vnd.apple.mpegurl';
	if (file.endsWith('.ts')) return 'video/mp2t';
	return 'application/octet-stream';
}

async function uploadHls(videoId: string, outDir: string, signal: AbortSignal) {
	const entries = await readdir(outDir, { recursive: true, withFileTypes: true });
	const files = entries
		.filter((entry) => entry.isFile() && !entry.name.startsWith('poster'))
		.map((entry) => join(entry.parentPath, entry.name));

	// A few uploads at a time: faster than one by one, without flooding the storage.
	const queue = [...files];
	await Promise.all(
		Array.from({ length: UPLOAD_CONCURRENCY }, async () => {
			for (let file = queue.pop(); file; file = queue.pop()) {
				signal.throwIfAborted();
				const key = hlsKey(videoId, relative(outDir, file).replaceAll('\\', '/'));
				await uploadFile(storage, key, file, contentType(file));
			}
		})
	);

	signal.throwIfAborted();
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
async function storeOutput(videoId: string, outDir: string, signal: AbortSignal) {
	const bytes = await folderBytes(outDir);

	const outcome = await reserveStorageAs(db, videoId, workerId, bytes, config.storageLimitBytes);
	if (outcome === 'lost') throw new LeaseLost();
	if (outcome === 'full') throw new StorageFullError();

	try {
		await uploadHls(videoId, outDir, signal);
	} catch (cause) {
		// If the video has passed to another worker, the files and the count are
		// that worker's now: it clears and recounts when it takes over. Touching
		// them here could delete what it is in the middle of writing.
		const stillMine = await db.select({ id: videos.id }).from(videos).where(mine(videoId));
		if (stillMine.length > 0) {
			await deleteVideoFiles(storage, videoId, { keepOriginal: true }).catch((cleanup) =>
				console.error(`could not remove partial output of ${videoId}`, cleanup)
			);
			await releaseStorageAs(db, videoId, workerId, bytes);
		}
		throw cause;
	}
}

async function processVideo(video: Video, takenOver: boolean) {
	const workDir = await mkdtemp(join(tmpdir(), `video-${video.id}-`));
	const input = join(workDir, 'source');
	const outDir = join(workDir, 'out');

	// Stops this one job: on shutdown, or when the lease turns out to be gone.
	const job = new AbortController();
	const onShutdown = () => job.abort();
	shutdown.signal.addEventListener('abort', onShutdown, { once: true });

	// Keep the claim alive. Three renewals fit in one lease, so a single slow or
	// failed renewal is not enough to lose it.
	let leaseLost = false;
	const heartbeat = setInterval(async () => {
		try {
			const renewed = await db
				.update(videos)
				.set({ lockedUntil: leaseExpiry })
				.where(mine(video.id))
				.returning({ id: videos.id });
			if (renewed.length === 0) {
				leaseLost = true;
				job.abort();
			}
		} catch (cause) {
			// The database may be briefly unreachable. If it stays that way the
			// lease expires, another worker takes over, and the next renewal that
			// does get through finds the video gone and stops this job.
			console.error(`could not renew the lease on ${video.id}`, cause);
		}
	}, (config.leaseSeconds * 1000) / 3);

	try {
		if (takenOver) {
			// The worker before this one may have died after reserving room or
			// after storing some renditions. Remove what it left and count again
			// from what is really there.
			await deleteVideoFiles(storage, video.id, { keepOriginal: true });
			await setStorage(db, video.id, await measureVideoBytes(storage, video.id));
		}

		await downloadToFile(storage, sourceKey(video.id), input);
		const source = await probe(input, job.signal);

		let lastSaved = 0;
		await transcode(input, outDir, source, job.signal, (percent) => {
			// Saving on every ffmpeg report would be hundreds of writes; once a second is plenty.
			if (job.signal.aborted || Date.now() - lastSaved < 1000) return;
			lastSaved = Date.now();
			db.update(videos)
				.set({ progress: percent })
				.where(mine(video.id))
				.catch((cause) => console.error('could not save progress', cause));
		});

		await storeOutput(video.id, outDir, job.signal);

		const finished = await db
			.update(videos)
			.set({
				status: 'ready',
				progress: 100,
				width: source.width,
				height: source.height,
				durationSeconds: Math.round(source.durationSeconds),
				lockedBy: null,
				lockedUntil: null,
				updatedAt: new Date()
			})
			.where(mine(video.id))
			.returning({ id: videos.id });
		if (finished.length === 0) throw new LeaseLost();

		console.log(`ready ${video.id} "${video.title}"`);
	} catch (cause) {
		if (leaseLost || cause instanceof LeaseLost) {
			// Another worker has it. Leave the row, the files and the count alone.
			console.log(`lost the lease on ${video.id}; leaving it to its new worker`);
			return;
		}

		if (shutdown.signal.aborted) {
			// Interrupted, not broken: put it back for another worker, and do not
			// count this as an attempt.
			await db
				.update(videos)
				.set({
					status: 'queued',
					progress: 0,
					lockedBy: null,
					lockedUntil: null,
					attempts: sql`greatest(${videos.attempts} - 1, 0)`,
					updatedAt: new Date()
				})
				.where(mine(video.id));
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
			.set({
				status: 'failed',
				error: message.slice(0, 1000),
				lockedBy: null,
				lockedUntil: null,
				updatedAt: new Date()
			})
			.where(mine(video.id));
		console.error(`failed ${video.id}: ${message}`);
	} finally {
		clearInterval(heartbeat);
		shutdown.signal.removeEventListener('abort', onShutdown);
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
			// Several workers may start together and measure the same video; only
			// the first to record it counts.
			if (bytes > 0 && (await setStorageIfUncounted(db, id, bytes))) {
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

console.log(`worker ${workerId} started`);

await backfillPosters();
await backfillStoredBytes();

let lastUploadCleanup = 0;

while (!shutdown.signal.aborted) {
	if (Date.now() - lastUploadCleanup > UPLOAD_CLEANUP_MS) {
		lastUploadCleanup = Date.now();
		await removeAbandonedUploads().catch((cause) => console.error('upload cleanup failed', cause));
	}

	const claim = await claimNext();
	if (claim?.gaveUp) {
		console.error(`gave up on ${claim.video.id} after ${claim.video.attempts} attempts`);
	} else if (claim) {
		console.log(
			`processing ${claim.video.id} "${claim.video.title}"${claim.takenOver ? ' (taken over from a worker that stopped)' : ''}`
		);
		await processVideo(claim.video, claim.takenOver);
	} else {
		await sleep(POLL_MS, undefined, { signal: shutdown.signal }).catch(() => {});
	}
}

await db.$client.end();
console.log('worker stopped');
