import { error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { videos } from 'shared/db';
import { hlsKey, openObject, posterKey } from 'shared/storage';
import { db } from '#lib/server/db.ts';
import { storage } from '#lib/server/storage.ts';
import type { RequestHandler } from './$types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Only the files the worker writes can be requested; nothing else in the bucket is reachable.
const PLAYLIST = /^(master|\d+p\/index)\.m3u8$/;
const SEGMENT = /^\d+p\/seg_\d+\.ts$/;

export const GET: RequestHandler = async ({ params, locals }) => {
	const { id, path } = params;
	if (!UUID.test(id)) error(404, 'Not found');

	let key: string;
	let maxAge: number;
	if (path === 'poster.jpg') {
		key = posterKey(id);
		maxAge = 3600;
	} else if (PLAYLIST.test(path)) {
		key = hlsKey(id, path);
		maxAge = 60;
	} else if (SEGMENT.test(path)) {
		key = hlsKey(id, path);
		maxAge = 86400;
	} else {
		error(404, 'Not found');
	}

	const [video] = await db
		.select({ status: videos.status, publishedAt: videos.publishedAt })
		.from(videos)
		.where(eq(videos.id, id));

	const isPublic = video?.status === 'ready' && video.publishedAt !== null;
	if (!video || (!isPublic && !locals.admin)) error(404, 'Not found');

	const object = await openObject(storage, key);
	if (!object) error(404, 'Not found');

	const headers = new Headers({
		'content-type': object.contentType,
		// An admin preview must not be stored by shared caches.
		'cache-control': isPublic ? `public, max-age=${maxAge}` : 'private, no-store'
	});
	if (object.contentLength !== undefined) {
		headers.set('content-length', String(object.contentLength));
	}

	return new Response(object.body, { headers });
};
