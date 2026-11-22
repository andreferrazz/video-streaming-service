import { error } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { videos } from 'shared/db';
import type { UploadedPart } from 'shared/storage';
import { UPLOAD_MAX_GB } from '$app/env/private';
import { db } from './db.ts';

// A direct upload: the browser sends a file to storage in parts, and the app
// only coordinates. This module holds the rules both sides must agree on.

const MIB = 1024 * 1024;

/** S3 allows at most this many parts in one upload. */
const MAX_PARTS = 10_000;
/** Large enough that a typical video is a few hundred parts, small enough that a failed part is cheap to resend. */
const DEFAULT_PART_BYTES = 16 * MIB;

/** The largest single file accepted, in bytes. */
export const uploadMaxBytes = UPLOAD_MAX_GB * 1_000_000_000;

/** How long a signed address for one part stays valid. */
export const PART_URL_SECONDS = 60 * 60;

/** How many part addresses may be requested in one call. */
export const MAX_PARTS_PER_REQUEST = 50;

/** The part size for a file: the default, or larger if the file would need too many parts. */
export function partBytesFor(fileBytes: number) {
	const needed = Math.ceil(fileBytes / MAX_PARTS / MIB) * MIB;
	return Math.max(DEFAULT_PART_BYTES, needed);
}

export function partCountFor(fileBytes: number, partBytes: number) {
	return Math.ceil(fileBytes / partBytes);
}

/** How large part `partNumber` must be: full size, except the last, which is whatever is left. */
export function expectedPartBytes(fileBytes: number, partBytes: number, partNumber: number) {
	const count = partCountFor(fileBytes, partBytes);
	return partNumber < count ? partBytes : fileBytes - partBytes * (count - 1);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The video row of an upload that is still in progress, or a 404. */
export async function findUpload(id: string) {
	if (!UUID.test(id)) error(404, 'Upload not found');

	const [video] = await db
		.select()
		.from(videos)
		.where(and(eq(videos.id, id), eq(videos.status, 'uploading')));

	if (!video || !video.uploadId || !video.uploadBytes || !video.uploadPartBytes) {
		error(404, 'Upload not found');
	}

	return {
		id: video.id,
		title: video.title,
		uploadId: video.uploadId,
		bytes: video.uploadBytes,
		partBytes: video.uploadPartBytes,
		partCount: partCountFor(video.uploadBytes, video.uploadPartBytes)
	};
}

export type UploadInProgress = Awaited<ReturnType<typeof findUpload>>;

/**
 * Which parts are safely in storage. A part only counts if it has the size it
 * should have; one cut short by a dropped connection has to be sent again.
 */
export function completedParts(upload: UploadInProgress, stored: UploadedPart[]) {
	return stored.filter(
		(part) =>
			part.partNumber >= 1 &&
			part.partNumber <= upload.partCount &&
			part.size === expectedPartBytes(upload.bytes, upload.partBytes, part.partNumber)
	);
}
