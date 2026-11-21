import { json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { videos } from 'shared/db';
import { abortMultipartUpload, listUploadedParts, sourceKey } from 'shared/storage';
import { db } from '#lib/server/db.ts';
import { storage } from '#lib/server/storage.ts';
import { completedParts, findUpload } from '#lib/server/uploads.ts';
import type { RequestHandler } from './$types';

/** Where an upload stands: which parts storage already has. This is what makes resuming possible. */
export const GET: RequestHandler = async ({ params }) => {
	const upload = await findUpload(params.id);
	const stored = await listUploadedParts(storage, sourceKey(upload.id), upload.uploadId);

	return json({
		id: upload.id,
		title: upload.title,
		size: upload.bytes,
		partSize: upload.partBytes,
		partCount: upload.partCount,
		uploadedParts: completedParts(upload, stored).map((part) => part.partNumber)
	});
};

/** Cancel an upload: discard the parts and give back the room it had reserved. */
export const DELETE: RequestHandler = async ({ params }) => {
	const upload = await findUpload(params.id);

	await abortMultipartUpload(storage, sourceKey(upload.id), upload.uploadId);
	// Removing the row is what releases the reservation: usage is the sum over rows.
	await db.delete(videos).where(eq(videos.id, upload.id));

	return new Response(null, { status: 204 });
};
