// Uploads a file from the browser straight to storage, in parts.
//
// The app only coordinates: it says how to cut the file up, hands out a signed
// address for each part, and at the end checks with storage that everything
// arrived. If the connection drops or the page is closed, choosing the same
// file again carries on from the parts already stored.

/** How many parts are sent at the same time. */
const PARALLEL_PARTS = 4;
/** How many part addresses to ask for in one go. */
const ADDRESSES_PER_REQUEST = 12;
/** A part that keeps failing is given up on after this many tries. */
const TRIES_PER_PART = 6;
/** An address is treated as stale a little before the server says it expires. */
const ADDRESS_SAFETY_MS = 60_000;

export type UploadState = 'starting' | 'uploading' | 'paused' | 'finishing' | 'done' | 'failed';

export interface UploadProgress {
	state: UploadState;
	/** Bytes safely in storage plus bytes of parts on their way. */
	uploadedBytes: number;
	totalBytes: number;
	/** True when this run picked up an upload started earlier. */
	resumed: boolean;
	/** Why it failed, when state is "failed". */
	message?: string;
}

interface Plan {
	id: string;
	partSize: number;
	partCount: number;
	uploadedParts: number[];
}

class UploadError extends Error {}

/** Thrown inside the uploader when it has been paused or cancelled; never shown. */
class Stopped extends Error {}

async function api<T>(method: string, path: string, body?: unknown): Promise<{ status: number; data: T }> {
	const response = await fetch(path, {
		method,
		headers: body === undefined ? undefined : { 'content-type': 'application/json' },
		body: body === undefined ? undefined : JSON.stringify(body)
	});
	const data = (await response.json().catch(() => ({}))) as T;
	return { status: response.status, data };
}

/** Identifies a file well enough to recognise it again after a reload. */
function fingerprint(file: File) {
	return `upload:${file.name}:${file.size}:${file.lastModified}`;
}

function remember(file: File, id: string) {
	try {
		localStorage.setItem(fingerprint(file), id);
	} catch {
		// Private browsing or a full store: the upload works, it just cannot resume after a reload.
	}
}

function recall(file: File) {
	try {
		return localStorage.getItem(fingerprint(file));
	} catch {
		return null;
	}
}

function forget(file: File) {
	try {
		localStorage.removeItem(fingerprint(file));
	} catch {
		// Nothing to forget.
	}
}

/** Whether an unfinished upload of this file is waiting to be continued. */
export function hasUnfinishedUpload(file: File) {
	return recall(file) !== null;
}

function wait(ms: number, signal: AbortSignal) {
	return new Promise<void>((resolve, reject) => {
		const timer = setTimeout(resolve, ms);
		signal.addEventListener(
			'abort',
			() => {
				clearTimeout(timer);
				reject(new Stopped());
			},
			{ once: true }
		);
	});
}

/** Resolves once the browser believes it is online again. */
function online(signal: AbortSignal) {
	if (navigator.onLine) return Promise.resolve();
	return new Promise<void>((resolve, reject) => {
		const done = () => {
			window.removeEventListener('online', done);
			resolve();
		};
		window.addEventListener('online', done);
		signal.addEventListener(
			'abort',
			() => {
				window.removeEventListener('online', done);
				reject(new Stopped());
			},
			{ once: true }
		);
	});
}

/**
 * Send one part. fetch cannot report upload progress, so this uses
 * XMLHttpRequest. Resolves with the HTTP status, or 0 if the network failed.
 */
function sendPart(url: string, body: Blob, signal: AbortSignal, onProgress: (sent: number) => void) {
	return new Promise<number>((resolve, reject) => {
		const request = new XMLHttpRequest();
		request.open('PUT', url);
		request.upload.onprogress = (event) => onProgress(event.loaded);
		request.onload = () => resolve(request.status);
		request.onerror = () => resolve(0);
		request.onabort = () => reject(new Stopped());
		signal.addEventListener('abort', () => request.abort(), { once: true });
		request.send(body);
	});
}

export function createUploader(
	file: File,
	title: string,
	onProgress: (progress: UploadProgress) => void
) {
	let plan: Plan | undefined;
	let state: UploadState = 'starting';
	let resumed = false;
	let stop = new AbortController();

	/** Bytes of each finished part, and of each part currently being sent. */
	const finished = new Map<number, number>();
	const inFlight = new Map<number, number>();
	const addresses = new Map<number, { url: string; staleAt: number }>();

	function report(message?: string) {
		let uploadedBytes = 0;
		for (const bytes of finished.values()) uploadedBytes += bytes;
		for (const bytes of inFlight.values()) uploadedBytes += bytes;
		onProgress({ state, uploadedBytes, totalBytes: file.size, resumed, message });
	}

	function setState(next: UploadState, message?: string) {
		state = next;
		report(message);
	}

	function partBlob(number: number) {
		const from = (number - 1) * plan!.partSize;
		return file.slice(from, Math.min(from + plan!.partSize, file.size));
	}

	/** Continue an earlier upload of this same file if the server still has it, else start a new one. */
	async function prepare(): Promise<Plan> {
		const earlier = recall(file);
		if (earlier) {
			const { status, data } = await api<Plan & { size: number }>('GET', `/admin/uploads/${earlier}`);
			if (status === 200 && data.size === file.size) {
				resumed = data.uploadedParts.length > 0;
				return data;
			}
			// It finished, was cancelled, or expired. Start over.
			forget(file);
		}

		const { status, data } = await api<Plan & { message?: string }>('POST', '/admin/uploads', {
			title,
			size: file.size,
			contentType: file.type || 'application/octet-stream'
		});
		if (status !== 201) {
			throw new UploadError(data.message ?? `The upload could not be started (${status}).`);
		}
		remember(file, data.id);
		return { ...data, uploadedParts: [] };
	}

	/** A signed address for a part, asking the server for a batch when none is in hand. */
	async function addressFor(number: number, pending: number[]) {
		const known = addresses.get(number);
		if (known && known.staleAt > Date.now()) return known.url;

		// Ask for this part and the next few that will be needed.
		const wanted = [number, ...pending.filter((other) => other !== number)].slice(
			0,
			ADDRESSES_PER_REQUEST
		);
		const { status, data } = await api<{
			urls: Record<string, string>;
			expiresInSeconds: number;
			message?: string;
		}>('POST', `/admin/uploads/${plan!.id}/parts`, { partNumbers: wanted });
		if (status !== 200) {
			throw new UploadError(data.message ?? `The server refused to continue the upload (${status}).`);
		}

		const staleAt = Date.now() + data.expiresInSeconds * 1000 - ADDRESS_SAFETY_MS;
		for (const [part, url] of Object.entries(data.urls)) {
			addresses.set(Number(part), { url, staleAt });
		}
		return addresses.get(number)!.url;
	}

	async function uploadPart(number: number, pending: number[]) {
		const body = partBlob(number);

		for (let attempt = 1; ; attempt++) {
			await online(stop.signal);
			let status = 0;
			try {
				const url = await addressFor(number, pending);
				inFlight.set(number, 0);
				status = await sendPart(url, body, stop.signal, (sent) => {
					inFlight.set(number, Math.min(sent, body.size));
					report();
				});
			} catch (cause) {
				inFlight.delete(number);
				if (cause instanceof Stopped || cause instanceof UploadError) throw cause;
				// A failed request for addresses: treated like a failed part, and retried.
			}
			inFlight.delete(number);

			if (status >= 200 && status < 300) {
				finished.set(number, body.size);
				report();
				return;
			}

			// Refused: most likely the address expired. Get a fresh one next time round.
			if (status === 403) addresses.delete(number);

			if (attempt >= TRIES_PER_PART) {
				throw new UploadError(
					'The connection keeps failing. Check it and press Resume to carry on from here.'
				);
			}
			report();
			// 1, 2, 4, 8, 16 seconds.
			await wait(1000 * 2 ** (attempt - 1), stop.signal);
		}
	}

	/** Send every part in `numbers`, a few at a time. */
	async function uploadParts(numbers: number[]) {
		const pending = [...numbers];
		await Promise.all(
			Array.from({ length: Math.min(PARALLEL_PARTS, pending.length) }, async () => {
				for (let number = pending.shift(); number !== undefined; number = pending.shift()) {
					await uploadPart(number, pending);
				}
			})
		);
	}

	async function run(): Promise<string | null> {
		try {
			if (!plan) {
				setState('starting');
				plan = await prepare();
				for (const number of plan.uploadedParts) finished.set(number, partBlob(number).size);
			}

			setState('uploading');
			const all = Array.from({ length: plan.partCount }, (_, i) => i + 1);
			await uploadParts(all.filter((number) => !finished.has(number)));

			// The server checks with storage. If it finds a part missing or cut short,
			// it says which, and those are sent again.
			for (let round = 1; ; round++) {
				setState('finishing');
				const { status, data } = await api<{ missingParts?: number[]; message?: string }>(
					'POST',
					`/admin/uploads/${plan.id}/complete`
				);
				if (status === 200) break;
				if (status === 409 && data.missingParts?.length && round <= 3) {
					for (const number of data.missingParts) finished.delete(number);
					setState('uploading');
					await uploadParts(data.missingParts);
					continue;
				}
				throw new UploadError(data.message ?? `The upload could not be finished (${status}).`);
			}

			forget(file);
			setState('done');
			return plan.id;
		} catch (cause) {
			if (cause instanceof Stopped) return null;
			setState(
				'failed',
				cause instanceof UploadError ? cause.message : 'The upload stopped unexpectedly.'
			);
			return null;
		}
	}

	return {
		/** Begin, or carry on after a pause or failure. Resolves with the video id once done. */
		start() {
			stop = new AbortController();
			return run();
		},

		/** Stop sending. Parts already stored are kept; parts on their way are sent again later. */
		pause() {
			stop.abort();
			inFlight.clear();
			setState('paused');
		},

		/** Stop for good, discard what was stored and free the room it had reserved. */
		async cancel() {
			stop.abort();
			inFlight.clear();
			forget(file);
			if (plan) await api('DELETE', `/admin/uploads/${plan.id}`).catch(() => {});
		}
	};
}

export type Uploader = ReturnType<typeof createUploader>;
