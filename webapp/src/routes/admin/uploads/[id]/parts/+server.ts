import { error, json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { videos } from 'shared/db';
import { signPartUpload, sourceKey } from 'shared/storage';
import { db } from '#lib/server/db.ts';
import { storage } from '#lib/server/storage.ts';
import { MAX_PARTS_PER_REQUEST, PART_URL_SECONDS, findUpload } from '#lib/server/uploads.ts';
import type { RequestHandler } from './$types';

/**
 * Hand out signed addresses for some parts. Each lets the browser send that one
 * part straight to storage for a limited time, with no credentials of its own.
 */
export const POST: RequestHandler = async ({ params, request }) => {
	const upload = await findUpload(params.id);

	const body = await request.json().catch(() => null);
	const numbers: unknown = body?.partNumbers;
	if (!Array.isArray(numbers) || numbers.length === 0 || numbers.length > MAX_PARTS_PER_REQUEST) {
		error(400, `Ask for between 1 and ${MAX_PARTS_PER_REQUEST} parts at a time.`);
	}
	for (const number of numbers) {
		if (!Number.isInteger(number) || number < 1 || number > upload.partCount) {
			error(400, `Part numbers run from 1 to ${upload.partCount}.`);
		}
	}

	const urls: Record<number, string> = {};
	await Promise.all(
		(numbers as number[]).map(async (number) => {
			urls[number] = await signPartUpload(
				storage,
				sourceKey(upload.id),
				upload.uploadId,
				number,
				PART_URL_SECONDS
			);
		})
	);

	// Marks the upload as active, so a long one is not mistaken for an abandoned one.
	await db.update(videos).set({ updatedAt: new Date() }).where(eq(videos.id, upload.id));

	return json({ urls, expiresInSeconds: PART_URL_SECONDS });
};
