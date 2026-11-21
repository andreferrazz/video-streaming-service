import { eq, sql } from 'drizzle-orm';
import type { Db } from './index.ts';
import { videos } from './schema.ts';

// The app keeps its own count of what is stored, in videos.stored_bytes, and
// enforces the limit itself. That works with any storage provider, where a
// provider-side quota only exists on some.

/** Any fixed number: it names the lock that serialises reservations. */
const RESERVATION_LOCK = 7_301_001;

/** Bytes currently held by all videos, including space reserved for uploads in progress. */
export async function storageUsed(db: Db) {
	const [row] = await db
		.select({ used: sql<string>`coalesce(sum(${videos.storedBytes}), 0)` })
		.from(videos);
	return Number(row.used);
}

/**
 * Set aside `bytes` for a video if the total would stay within `limitBytes`.
 * Returns false, and changes nothing, if it would not.
 *
 * Space is reserved before anything is written, so two uploads arriving
 * together cannot both squeeze into the last free gigabyte: the check and the
 * reservation happen under one lock.
 */
export async function reserveStorage(db: Db, videoId: string, bytes: number, limitBytes: number) {
	return db.transaction(async (tx) => {
		await tx.execute(sql`select pg_advisory_xact_lock(${RESERVATION_LOCK})`);

		const [row] = await tx
			.select({ used: sql<string>`coalesce(sum(${videos.storedBytes}), 0)` })
			.from(videos);
		if (Number(row.used) + bytes > limitBytes) return false;

		await tx
			.update(videos)
			.set({ storedBytes: sql`${videos.storedBytes} + ${bytes}` })
			.where(eq(videos.id, videoId));
		return true;
	});
}

/** Add to, or with a negative number give back, what a video is counted as holding. */
export async function adjustStorage(db: Db, videoId: string, deltaBytes: number) {
	await db
		.update(videos)
		.set({ storedBytes: sql`greatest(${videos.storedBytes} + ${deltaBytes}, 0)` })
		.where(eq(videos.id, videoId));
}

/** Record exactly what a video holds, replacing whatever was counted before. */
export async function setStorage(db: Db, videoId: string, bytes: number) {
	await db.update(videos).set({ storedBytes: bytes }).where(eq(videos.id, videoId));
}
