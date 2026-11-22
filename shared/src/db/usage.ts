import { and, eq, sql } from 'drizzle-orm';
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

/**
 * Like reserveStorage, for a worker: the room is only set aside if `owner` still
 * holds the lease on the video. A worker that was presumed dead and replaced
 * must not add to a count its successor is now responsible for.
 */
export async function reserveStorageAs(
	db: Db,
	videoId: string,
	owner: string,
	bytes: number,
	limitBytes: number
): Promise<'reserved' | 'full' | 'lost'> {
	return db.transaction(async (tx) => {
		await tx.execute(sql`select pg_advisory_xact_lock(${RESERVATION_LOCK})`);

		const [row] = await tx
			.select({ used: sql<string>`coalesce(sum(${videos.storedBytes}), 0)` })
			.from(videos);
		if (Number(row.used) + bytes > limitBytes) return 'full';

		const updated = await tx
			.update(videos)
			.set({ storedBytes: sql`${videos.storedBytes} + ${bytes}` })
			.where(and(eq(videos.id, videoId), eq(videos.lockedBy, owner)))
			.returning({ id: videos.id });
		return updated.length > 0 ? 'reserved' : 'lost';
	});
}

/** Give room back, but only while `owner` still holds the lease on the video. */
export async function releaseStorageAs(db: Db, videoId: string, owner: string, bytes: number) {
	await db
		.update(videos)
		.set({ storedBytes: sql`greatest(${videos.storedBytes} - ${bytes}, 0)` })
		.where(and(eq(videos.id, videoId), eq(videos.lockedBy, owner)));
}

/**
 * Record what a video holds, but only if nothing is recorded yet. Several
 * workers may measure the same old video at the same moment; only one may count it.
 */
export async function setStorageIfUncounted(db: Db, videoId: string, bytes: number) {
	const updated = await db
		.update(videos)
		.set({ storedBytes: bytes })
		.where(and(eq(videos.id, videoId), eq(videos.storedBytes, 0)))
		.returning({ id: videos.id });
	return updated.length > 0;
}
