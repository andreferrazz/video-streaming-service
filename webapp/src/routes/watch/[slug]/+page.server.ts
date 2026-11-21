import { error } from '@sveltejs/kit';
import { and, desc, eq, isNotNull, ne } from 'drizzle-orm';
import { videos } from 'shared/db';
import { db } from '#lib/server/db.ts';
import type { PageServerLoad } from './$types';

// How long a shared cache (a CDN) may reuse a published video's page.
const SHARED_CACHE_SECONDS = 30;

export const load: PageServerLoad = async ({ params, locals, setHeaders }) => {
	const [video] = await db
		.select({
			id: videos.id,
			title: videos.title,
			description: videos.description,
			status: videos.status,
			durationSeconds: videos.durationSeconds,
			publishedAt: videos.publishedAt
		})
		.from(videos)
		.where(eq(videos.slug, params.slug));

	const isPublic = video?.status === 'ready' && video.publishedAt !== null;
	// The admin may watch a video that is ready but not published yet.
	const canWatch = isPublic || (locals.admin && video?.status === 'ready');
	if (!video || !canWatch) error(404, 'Video not found');

	// A published video's page is the same for every visitor, so shared caches may
	// reuse it briefly, as with the home page. An admin's preview of an unpublished
	// video must never be kept by any cache.
	setHeaders({
		'cache-control': isPublic
			? `public, max-age=0, s-maxage=${SHARED_CACHE_SECONDS}, stale-while-revalidate=${SHARED_CACHE_SECONDS * 2}`
			: 'private, no-store'
	});

	// A few other published videos to keep watching.
	const more = await db
		.select({
			id: videos.id,
			slug: videos.slug,
			title: videos.title,
			durationSeconds: videos.durationSeconds
		})
		.from(videos)
		.where(and(eq(videos.status, 'ready'), isNotNull(videos.publishedAt), ne(videos.id, video.id)))
		.orderBy(desc(videos.publishedAt))
		.limit(8);

	return {
		video: {
			id: video.id,
			title: video.title,
			description: video.description,
			durationSeconds: video.durationSeconds,
			publishedAt: video.publishedAt
		},
		more
	};
};
