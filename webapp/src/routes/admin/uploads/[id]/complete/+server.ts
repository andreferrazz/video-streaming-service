import { error, json } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { videos } from 'shared/db';
import { completeMultipartUpload, listUploadedParts, sourceKey } from 'shared/storage';
import { db } from '#lib/server/db.ts';
import { storage } from '#lib/server/storage.ts';
import { completedParts, findUpload } from '#lib/server/uploads.ts';
import type { RequestHandler } from './$types';

/**
 * Finish an upload. The browser only says "done": the app asks storage which
 * parts it really holds, and assembles the file only if every part is there at
 * exactly the size it should be. The total then equals what was declared, and
 * therefore what was reserved.
 */
export const POST: RequestHandler = async ({ params }) => {
	const upload = await findUpload(params.id);
	const key = sourceKey(upload.id);

	const good = completedParts(upload, await listUploadedParts(storage, key, upload.uploadId));

	if (good.length !== upload.partCount) {
		const have = new Set(good.map((part) => part.partNumber));
		const missing = Array.from({ length: upload.partCount }, (_, i) => i + 1).filter(
			(number) => !have.has(number)
		);
		// Not a server fault: the browser has more to send, and is told what.
		return json(
			{ message: 'Some parts are missing or incomplete.', missingParts: missing },
			{ status: 409 }
		);
	}

	await completeMultipartUpload(storage, key, upload.uploadId, good);

	// Only one request may hand the video to the worker, even if two arrive together.
	const queued = await db
		.update(videos)
		.set({
			status: 'queued',
			uploadId: null,
			uploadBytes: null,
			uploadPartBytes: null,
			updatedAt: new Date()
		})
		.where(and(eq(videos.id, upload.id), eq(videos.status, 'uploading')))
		.returning({ id: videos.id });

	if (queued.length === 0) error(409, 'This upload was already finished.');

	return json({ id: upload.id });
};
