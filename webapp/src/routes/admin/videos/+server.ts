import { randomBytes } from 'node:crypto';
import { error, json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { videos } from 'shared/db';
import { isStorageFull, sourceKey, uploadStream } from 'shared/storage';
import { db } from '#lib/server/db.ts';
import { storage } from '#lib/server/storage.ts';
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
export const POST: RequestHandler = async ({ request, url }) => {
	const title = url.searchParams.get('title')?.trim();
	if (!title) error(400, 'A title is required.');
	if (!request.body) error(400, 'The request has no file.');

	const [video] = await db
		.insert(videos)
		.values({ title, slug: slugify(title) })
		.returning({ id: videos.id });

	try {
		await uploadStream(
			storage,
			sourceKey(video.id),
			request.body,
			request.headers.get('content-type') ?? 'application/octet-stream'
		);
	} catch (cause) {
		// A full bucket is the admin's to fix, so say so plainly instead of a generic failure.
		const full = isStorageFull(cause);
		const message = full
			? 'Storage is full. Delete some videos to make room, then upload again.'
			: 'Upload failed.';

		await db
			.update(videos)
			.set({ status: 'failed', error: message, updatedAt: new Date() })
			.where(eq(videos.id, video.id));
		console.error('upload failed', video.id, cause);
		error(full ? 507 : 500, message);
	}

	await db
		.update(videos)
		.set({ status: 'queued', updatedAt: new Date() })
		.where(eq(videos.id, video.id));

	return json({ id: video.id }, { status: 201 });
};
