import { fail, redirect } from '@sveltejs/kit';
import { and, desc, eq } from 'drizzle-orm';
import { videos } from 'shared/db';
import { db } from '#lib/server/db.ts';
import { SESSION_COOKIE } from '#lib/server/session.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const all = await db
		.select({
			id: videos.id,
			slug: videos.slug,
			title: videos.title,
			status: videos.status,
			progress: videos.progress,
			error: videos.error,
			publishedAt: videos.publishedAt
		})
		.from(videos)
		.orderBy(desc(videos.createdAt));

	return { videos: all };
};

async function videoId(request: Request) {
	const id = (await request.formData()).get('id');
	return typeof id === 'string' ? id : null;
}

export const actions: Actions = {
	publish: async ({ request }) => {
		const id = await videoId(request);
		if (!id) return fail(400, { error: 'Missing video.' });

		// Only a finished video can go public.
		const updated = await db
			.update(videos)
			.set({ publishedAt: new Date(), updatedAt: new Date() })
			.where(and(eq(videos.id, id), eq(videos.status, 'ready')))
			.returning({ id: videos.id });

		if (updated.length === 0) return fail(409, { error: 'That video is not ready yet.' });
	},

	unpublish: async ({ request }) => {
		const id = await videoId(request);
		if (!id) return fail(400, { error: 'Missing video.' });

		await db
			.update(videos)
			.set({ publishedAt: null, updatedAt: new Date() })
			.where(eq(videos.id, id));
	},

	logout: async ({ cookies }) => {
		cookies.delete(SESSION_COOKIE, { path: '/' });
		redirect(303, '/admin/login');
	}
};
