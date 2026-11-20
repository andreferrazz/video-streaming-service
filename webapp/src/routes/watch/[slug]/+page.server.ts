import { error } from '@sveltejs/kit';
import { and, desc, eq, isNotNull, ne } from 'drizzle-orm';
import { videos } from 'shared/db';
import { db } from '#lib/server/db.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => {
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
