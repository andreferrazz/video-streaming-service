import { error, fail, redirect } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { videos } from 'shared/db';
import { deleteVideoFiles } from 'shared/storage';
import { db } from '#lib/server/db.ts';
import { storage } from '#lib/server/storage.ts';
import type { Actions, PageServerLoad } from './$types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

async function findVideo(id: string) {
	// Postgres rejects a malformed uuid with an error, so filter those out first.
	if (!UUID.test(id)) error(404, 'Video not found');
	const [video] = await db.select().from(videos).where(eq(videos.id, id));
	if (!video) error(404, 'Video not found');
	return video;
}

export const load: PageServerLoad = async ({ params }) => {
	const video = await findVideo(params.id);

	return {
		video: {
			id: video.id,
			slug: video.slug,
			title: video.title,
			description: video.description,
			status: video.status,
			error: video.error,
			published: video.publishedAt !== null
		}
	};
};

export const actions: Actions = {
	save: async ({ params, request }) => {
		const form = await request.formData();
		const title = String(form.get('title') ?? '').trim();
		const description = String(form.get('description') ?? '').trim();

		if (!title) return fail(400, { error: 'A title is required.' });
		if (title.length > 200) {
			return fail(400, { error: 'The title is too long (200 characters at most).' });
		}
		if (description.length > 5000) {
			return fail(400, { error: 'The description is too long (5000 characters at most).' });
		}

		await findVideo(params.id);
		// The slug stays as it is, so links to the video keep working after a rename.
		await db
			.update(videos)
			.set({ title, description, updatedAt: new Date() })
			.where(eq(videos.id, params.id));

		return { saved: true };
	},

	retry: async ({ params }) => {
		await findVideo(params.id);

		const updated = await db
			.update(videos)
			.set({ status: 'queued', progress: 0, error: null, updatedAt: new Date() })
			.where(and(eq(videos.id, params.id), eq(videos.status, 'failed')))
			.returning({ id: videos.id });

		if (updated.length === 0) return fail(409, { error: 'Only a failed video can be retried.' });
		redirect(303, '/admin');
	},

	delete: async ({ params }) => {
		const video = await findVideo(params.id);

		// The worker is writing files for it right now; deleting would leave those behind.
		if (video.status === 'processing') {
			return fail(409, { error: 'This video is being processed. Wait until it finishes.' });
		}

		// Files first: if that fails, the row is still there and delete can be tried again.
		await deleteVideoFiles(storage, video.id);
		await db.delete(videos).where(eq(videos.id, video.id));

		redirect(303, '/admin');
	}
};
