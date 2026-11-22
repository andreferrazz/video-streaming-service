<script lang="ts">
	import { beforeNavigate, goto } from '$app/navigation';
	import { formatBytes } from '#lib/format.ts';
	import { SITE_NAME } from '#lib/site.ts';
	import {
		createUploader,
		hasUnfinishedUpload,
		type UploadProgress,
		type Uploader
	} from '#lib/upload.ts';

	let title = $state('');
	let files = $state<FileList>();
	let dragging = $state(false);
	let message = $state('');
	let progress = $state<UploadProgress | null>(null);
	let picker: HTMLInputElement;
	let uploader: Uploader | undefined;

	const file = $derived(files?.[0]);
	// From the moment Upload is pressed until it is done, cancelled or the file is changed.
	const active = $derived(progress !== null && progress.state !== 'done');
	const sending = $derived(
		progress !== null && ['starting', 'uploading', 'finishing'].includes(progress.state)
	);
	const percent = $derived(
		progress && progress.totalBytes > 0
			? Math.min(100, Math.floor((progress.uploadedBytes / progress.totalBytes) * 100))
			: 0
	);
	// A file whose earlier upload was interrupted can be continued, not started again.
	const canResume = $derived(file ? hasUnfinishedUpload(file) : false);

	// Suggest a title from the file name, unless one was already typed.
	$effect(() => {
		if (file && !title) {
			title = file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ');
		}
	});

	// Closing the tab mid-upload loses nothing that is already stored, but the
	// visitor should know the upload stops.
	$effect(() => {
		if (!sending) return;
		const warn = (event: BeforeUnloadEvent) => event.preventDefault();
		window.addEventListener('beforeunload', warn);
		return () => window.removeEventListener('beforeunload', warn);
	});

	beforeNavigate((navigation) => {
		if (sending && !confirm('An upload is in progress. Leave anyway? You can resume it later.')) {
			navigation.cancel();
		}
	});

	function drop(event: DragEvent) {
		event.preventDefault();
		dragging = false;
		if (active) return;

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

	async function run() {
		const id = await uploader?.start();
		if (id) goto('/admin');
	}

	function upload(event: SubmitEvent) {
		event.preventDefault();
		if (!file || active) return;

		message = '';
		uploader = createUploader(file, title, (next) => (progress = next));
		run();
	}

	function pause() {
		uploader?.pause();
	}

	async function cancel() {
		await uploader?.cancel();
		uploader = undefined;
		progress = null;
	}

	const status = $derived.by(() => {
		if (!progress) return '';
		switch (progress.state) {
			case 'starting':
				return 'Getting ready…';
			case 'uploading':
				return `Uploading… ${percent}%`;
			case 'paused':
				return `Paused at ${percent}%`;
			case 'finishing':
				return 'Checking the file arrived intact…';
			case 'failed':
				return `Stopped at ${percent}%`;
			default:
				return 'Done';
		}
	});
</script>

<svelte:head>
	<title>Upload · {SITE_NAME}</title>
</svelte:head>

<section class="page">
	<a class="back" href="/admin">← Library</a>
	<h1>Upload a video</h1>
	<p class="muted">
		The file goes straight to storage in pieces, so a dropped connection only costs the piece that
		was on its way. It is then converted into several qualities, and you can publish it once that
		is done.
	</p>

	<form class="card" onsubmit={upload}>
		<label
			class="drop"
			class:dragging
			class:chosen={file}
			class:locked={active}
			ondragover={(event) => {
				event.preventDefault();
				if (!active) dragging = true;
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
				disabled={active}
			/>
			<svg viewBox="0 0 24 24" width="34" height="34" aria-hidden="true"><path d="M12 16V5m0 0l-4.5 4.5M12 5l4.5 4.5M5 19h14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" /></svg>
			{#if file}
				<strong>{file.name}</strong>
				<span class="muted">
					{formatBytes(file.size)}{active ? '' : ' · click to choose another'}
				</span>
			{:else}
				<strong>Drop a video here</strong>
				<span class="muted">or click to choose a file</span>
			{/if}
		</label>

		<label class="field">
			<span>Title</span>
			<input class="input" bind:value={title} required maxlength="200" disabled={active} />
		</label>

		{#if canResume && !active}
			<p class="notice">
				An earlier upload of this file was interrupted. Pressing the button carries on from where
				it stopped.
			</p>
		{/if}

		{#if message}
			<p class="notice error" role="alert">{message}</p>
		{/if}

		{#if progress}
			<div class="progress" role="status">
				<div class="meter"><span style:width="{percent}%"></span></div>
				<div class="figures">
					<span>{status}</span>
					<span>{formatBytes(progress.uploadedBytes)} of {formatBytes(progress.totalBytes)}</span>
				</div>
				{#if progress.resumed && progress.state === 'uploading'}
					<span class="muted">Carrying on from an earlier upload.</span>
				{/if}
			</div>
		{/if}

		{#if progress?.state === 'failed'}
			<p class="notice error" role="alert">{progress.message}</p>
		{/if}

		<div class="submit">
			{#if !active}
				<button class="button">{canResume ? 'Resume upload' : 'Upload'}</button>
				<a class="button ghost" href="/admin">Back</a>
			{:else}
				{#if progress?.state === 'uploading' || progress?.state === 'starting'}
					<button class="button ghost" type="button" onclick={pause}>Pause</button>
				{:else if progress?.state === 'paused' || progress?.state === 'failed'}
					<button class="button" type="button" onclick={run}>Resume</button>
				{/if}
				{#if progress?.state !== 'finishing'}
					<button class="button danger" type="button" onclick={cancel}>Cancel upload</button>
				{/if}
			{/if}
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

	.drop:not(.locked):hover,
	.drop.dragging,
	.drop:not(.locked):focus-within {
		border-color: var(--accent);
		background: rgb(255 180 84 / 0.06);
		color: var(--accent);
	}

	.drop.chosen {
		border-style: solid;
		color: var(--success);
	}

	.drop.locked {
		cursor: default;
	}

	.progress {
		display: grid;
		gap: 0.5rem;
		color: var(--text-muted);
		font-size: 0.9rem;
		font-variant-numeric: tabular-nums;
	}

	.figures {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		gap: 0.25rem 1rem;
	}

	.submit {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
	}
</style>
