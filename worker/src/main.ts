import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { eq } from 'drizzle-orm';
import { createDb, videos, type Video } from 'shared/db';
import {
	createStorage,
	downloadToFile,
	hlsKey,
	isStorageFull,
	posterKey,
	sourceKey,
	uploadFile
} from 'shared/storage';
import { config } from './config.ts';
import { probe, transcode } from './transcode.ts';

const POLL_MS = 2000;
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
		.filter((entry) => entry.isFile() && entry.name !== 'poster.jpg')
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

	await uploadFile(storage, posterKey(videoId), join(outDir, 'poster.jpg'), 'image/jpeg');
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

		await uploadHls(video.id, outDir);

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

// A video still marked as processing at startup belongs to a worker that died. Run it again.
// This assumes a single worker; with several, each would steal the others' jobs here.
const stale = await db
	.update(videos)
	.set({ status: 'queued', progress: 0, updatedAt: new Date() })
	.where(eq(videos.status, 'processing'))
	.returning({ id: videos.id });
if (stale.length > 0) console.log(`requeued ${stale.length} interrupted video(s)`);

console.log('worker started');

while (!shutdown.signal.aborted) {
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
