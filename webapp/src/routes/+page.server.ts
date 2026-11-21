import { and, desc, eq, isNotNull } from 'drizzle-orm';
import { videos } from 'shared/db';
import { db } from '#lib/server/db.ts';
import type { PageServerLoad } from './$types';

// How long a shared cache (a CDN) may reuse this page before asking again.
const SHARED_CACHE_SECONDS = 30;

export const load: PageServerLoad = async ({ setHeaders }) => {
	// The page is the same for every visitor, so one rendered copy can serve all
	// of them. Browsers still check back every time (max-age=0); shared caches
	// keep it for a short while, and may serve the old copy while fetching a new one.
	setHeaders({
		'cache-control': `public, max-age=0, s-maxage=${SHARED_CACHE_SECONDS}, stale-while-revalidate=${SHARED_CACHE_SECONDS * 2}`
	});

	const published = await db
		.select({
			id: videos.id,
			slug: videos.slug,
			title: videos.title,
			description: videos.description,
			durationSeconds: videos.durationSeconds
		})
		.from(videos)
		.where(and(eq(videos.status, 'ready'), isNotNull(videos.publishedAt)))
		.orderBy(desc(videos.publishedAt));

	return { videos: published };
};
