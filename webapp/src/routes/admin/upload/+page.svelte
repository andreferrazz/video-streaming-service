<script lang="ts">
	import { goto } from '$app/navigation';
	import { SITE_NAME } from '#lib/site.ts';

	let title = $state('');
	let files = $state<FileList>();
	let progress = $state<number | null>(null);
	let message = $state('');
	let dragging = $state(false);
	let picker: HTMLInputElement;

	const file = $derived(files?.[0]);
	const uploading = $derived(progress !== null);

	function formatSize(bytes: number) {
		if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GB`;
		if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
		return `${Math.max(1, Math.round(bytes / 1e3))} KB`;
	}

	// Suggest a title from the file name, unless one was already typed.
	$effect(() => {
		if (file && !title) {
			title = file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ');
		}
	});

	function drop(event: DragEvent) {
		event.preventDefault();
		dragging = false;
		if (uploading) return;

		const dropped = event.dataTransfer?.files;
		if (!dropped?.length) return;
		if (!dropped[0].type.startsWith('video/')) {
			message = 'That file is not a video.';
			return;
		}
		message = '';
		// Putting the files on the input keeps the form and its validation in charge.
		picker.files = dropped;
		files = dropped;
	}

	function upload(event: SubmitEvent) {
		event.preventDefault();
		if (!file) return;

		message = '';
		progress = 0;

		// fetch cannot report upload progress, so this uses XMLHttpRequest.
		const request = new XMLHttpRequest();
		request.open('POST', `/admin/videos?title=${encodeURIComponent(title)}`);
		request.setRequestHeader('content-type', file.type || 'application/octet-stream');

		request.upload.onprogress = (e) => {
			if (e.lengthComputable) progress = Math.round((e.loaded / e.total) * 100);
		};

		request.onload = () => {
			progress = null;
			if (request.status === 201) {
				goto('/admin');
			} else {
				// The server explains what went wrong, for example that storage is full.
				let reason = '';
				try {
					reason = JSON.parse(request.responseText).message ?? '';
				} catch {
					// Not JSON; fall back to the status code below.
				}
				message = reason || `Upload failed (${request.status}).`;
			}
		};

		request.onerror = () => {
			progress = null;
			message = 'Upload failed: the connection was lost.';
		};

		request.send(file);
	}
</script>

<svelte:head>
	<title>Upload · {SITE_NAME}</title>
</svelte:head>

<section class="page">
	<a class="back" href="/admin">← Library</a>
	<h1>Upload a video</h1>
	<p class="muted">
		It is stored first, then converted into several qualities. You can publish it once that is done.
	</p>

	<form class="card" onsubmit={upload}>
		<label
			class="drop"
			class:dragging
			class:chosen={file}
			ondragover={(event) => {
				event.preventDefault();
				dragging = true;
			}}
			ondragleave={() => (dragging = false)}
			ondrop={drop}
		>
			<input
				bind:this={picker}
				class="visually-hidden"
				type="file"
				accept="video/*"
				bind:files
				required
				disabled={uploading}
			/>
			<svg viewBox="0 0 24 24" width="34" height="34" aria-hidden="true"><path d="M12 16V5m0 0l-4.5 4.5M12 5l4.5 4.5M5 19h14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" /></svg>
			{#if file}
				<strong>{file.name}</strong>
				<span class="muted">{formatSize(file.size)} · click to choose another</span>
			{:else}
				<strong>Drop a video here</strong>
				<span class="muted">or click to choose a file</span>
			{/if}
		</label>

		<label class="field">
			<span>Title</span>
			<input class="input" bind:value={title} required maxlength="200" disabled={uploading} />
		</label>

		{#if message}
			<p class="notice error" role="alert">{message}</p>
		{/if}

		{#if progress !== null}
			<div class="progress" role="status">
				<div class="meter"><span style:width="{progress}%"></span></div>
				<span>{progress === 100 ? 'Storing the file…' : `Uploading… ${progress}%`}</span>
			</div>
		{/if}

		<div class="submit">
			<button class="button" disabled={uploading}>{uploading ? 'Uploading…' : 'Upload'}</button>
			<a class="button ghost" href="/admin" aria-disabled={uploading}>Cancel</a>
		</div>
	</form>
</section>

<style>
	section {
		display: grid;
		gap: 0.9rem;
		max-width: 44rem;
		padding-top: clamp(2rem, 5vw, 3.5rem);
	}

	.back {
		color: var(--text-muted);
		font-size: 0.9rem;
		justify-self: start;
	}

	.back:hover {
		color: var(--text);
	}

	h1 {
		font-size: clamp(2.2rem, 5vw, 3.2rem);
	}

	form {
		display: grid;
		gap: 1.4rem;
		margin-top: 1rem;
		padding: clamp(1.25rem, 4vw, 2rem);
	}

	.drop {
		display: grid;
		justify-items: center;
		gap: 0.35rem;
		padding: clamp(2rem, 7vw, 3.25rem) 1.25rem;
		border: 1.5px dashed var(--line-strong);
		border-radius: var(--radius-m);
		background: rgb(0 0 0 / 0.22);
		color: var(--text-muted);
		text-align: center;
		cursor: pointer;
		transition:
			border-color 0.2s var(--ease),
			background 0.2s var(--ease),
			color 0.2s var(--ease);
	}

	.drop strong {
		margin-top: 0.4rem;
		color: var(--text);
		font-weight: 500;
		overflow-wrap: anywhere;
	}

	.drop:hover,
	.drop.dragging,
	.drop:focus-within {
		border-color: var(--accent);
		background: rgb(255 180 84 / 0.06);
		color: var(--accent);
	}

	.drop.chosen {
		border-style: solid;
		color: var(--success);
	}

	.progress {
		display: grid;
		gap: 0.5rem;
		color: var(--text-muted);
		font-size: 0.9rem;
		font-variant-numeric: tabular-nums;
	}

	.submit {
		display: flex;
		gap: 0.75rem;
	}

	[aria-disabled='true'] {
		pointer-events: none;
		opacity: 0.5;
	}
</style>
