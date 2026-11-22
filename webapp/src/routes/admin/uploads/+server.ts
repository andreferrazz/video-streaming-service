import { randomBytes } from 'node:crypto';
import { error, json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { adjustStorage, reserveStorage, videos } from 'shared/db';
import { sourceKey, startMultipartUpload } from 'shared/storage';
import { db } from '#lib/server/db.ts';
import { storage, storageLimitBytes } from '#lib/server/storage.ts';
import { partBytesFor, partCountFor, uploadMaxBytes } from '#lib/server/uploads.ts';
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
 * Start a direct upload. The browser says what it is about to send; the app
 * sets room aside, opens the upload in storage, and answers with how to cut the
 * file into parts. No file data passes through here.
 */
export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json().catch(() => null);
	const title = typeof body?.title === 'string' ? body.title.trim() : '';
	const bytes = body?.size;
	const contentType =
		typeof body?.contentType === 'string' && body.contentType
			? body.contentType.slice(0, 100)
			: 'application/octet-stream';

	if (!title) error(400, 'A title is required.');
	if (title.length > 200) error(400, 'The title is too long (200 characters at most).');
	if (!Number.isSafeInteger(bytes) || bytes <= 0) error(400, 'The file size is missing.');
	if (bytes > uploadMaxBytes) {
		error(413, `The file is too large. The limit is ${uploadMaxBytes / 1_000_000_000} GB.`);
	}

	const partBytes = partBytesFor(bytes);

	const [video] = await db
		.insert(videos)
		.values({ title, slug: slugify(title), uploadBytes: bytes, uploadPartBytes: partBytes })
		.returning({ id: videos.id });

	if (!(await reserveStorage(db, video.id, bytes, storageLimitBytes))) {
		// Nothing was stored, so leave no trace of the attempt.
		await db.delete(videos).where(eq(videos.id, video.id));
		error(507, 'Storage is full. Delete some videos to make room, then upload again.');
	}

	try {
		const uploadId = await startMultipartUpload(storage, sourceKey(video.id), contentType);
		await db.update(videos).set({ uploadId }).where(eq(videos.id, video.id));
	} catch (cause) {
		await adjustStorage(db, video.id, -bytes);
		await db.delete(videos).where(eq(videos.id, video.id));
		console.error('could not start upload', cause);
		error(502, 'Storage could not start the upload. Try again.');
	}

	return json(
		{ id: video.id, partSize: partBytes, partCount: partCountFor(bytes, partBytes) },
		{ status: 201 }
	);
};
