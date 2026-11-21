import { randomBytes } from 'node:crypto';
import { error, json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { adjustStorage, reserveStorage, videos } from 'shared/db';
import { isStorageFull, sourceKey, uploadStream } from 'shared/storage';
import { db } from '#lib/server/db.ts';
import { storage, storageLimitBytes } from '#lib/server/storage.ts';
import type { RequestHandler } from './$types';

function slugify(title: string) {
	const base = title
		.toLowerCase()
		.normalize('NFKD')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 60);
	// A short random suffix keeps slugs unique when two videos share a title.
	return `${base || 'video'}-${randomBytes(3).toString('hex')}`;
}

/**
 * Create a video from a raw file body. The title travels in the query string
 * so the body can be streamed to storage without being buffered or parsed.
 */
const STORAGE_FULL = 'Storage is full. Delete some videos to make room, then upload again.';

export const POST: RequestHandler = async ({ request, url }) => {
	const title = url.searchParams.get('title')?.trim();
	if (!title) error(400, 'A title is required.');
	if (!request.body) error(400, 'The request has no file.');

	// The size has to be known up front, so room can be set aside before a byte is stored.
	const declared = Number(request.headers.get('content-length'));
	if (!Number.isInteger(declared) || declared <= 0) {
		error(411, 'The upload must say how large the file is.');
	}

	const [video] = await db
		.insert(videos)
		.values({ title, slug: slugify(title) })
		.returning({ id: videos.id });

	if (!(await reserveStorage(db, video.id, declared, storageLimitBytes))) {
		// Nothing was stored, so leave no trace of the attempt.
		await db.delete(videos).where(eq(videos.id, video.id));
		error(507, STORAGE_FULL);
	}

	// Count what actually arrives, to correct the reservation afterwards.
	let received = 0;
	const counted = request.body.pipeThrough(
		new TransformStream<Uint8Array, Uint8Array>({
			transform(chunk, controller) {
				received += chunk.byteLength;
				controller.enqueue(chunk);
			}
		})
	);

	try {
		await uploadStream(
			storage,
			sourceKey(video.id),
			counted,
			request.headers.get('content-type') ?? 'application/octet-stream'
		);
	} catch (cause) {
		// A full bucket is the admin's to fix, so say so plainly instead of a generic failure.
		const full = isStorageFull(cause);
		const message = full ? STORAGE_FULL : 'Upload failed.';

		// Nothing is kept from a failed upload, so give the reserved room back.
		await adjustStorage(db, video.id, -declared);
		await db
			.update(videos)
			.set({ status: 'failed', error: message, updatedAt: new Date() })
			.where(eq(videos.id, video.id));
		console.error('upload failed', video.id, cause);
		error(full ? 507 : 500, message);
	}

	await adjustStorage(db, video.id, received - declared);
	await db
		.update(videos)
		.set({ status: 'queued', updatedAt: new Date() })
		.where(eq(videos.id, video.id));

	return json({ id: video.id }, { status: 201 });
};
