<script lang="ts">
	import { goto } from '$app/navigation';

	let title = $state('');
	let files = $state<FileList>();
	let progress = $state<number | null>(null);
	let message = $state('');

	const uploading = $derived(progress !== null);

	function upload(event: SubmitEvent) {
		event.preventDefault();
		const file = files?.[0];
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
				message = `Upload failed (${request.status}).`;
			}
		};

		request.onerror = () => {
			progress = null;
			message = 'Upload failed: the connection was lost.';
		};

		request.send(file);
	}
</script>

<h1>Upload a video</h1>

<form onsubmit={upload}>
	<label>
		Title
		<input bind:value={title} required disabled={uploading} />
	</label>
	<label>
		File
		<input type="file" accept="video/*" bind:files required disabled={uploading} />
	</label>
	<button disabled={uploading}>Upload</button>
</form>

{#if progress !== null}
	<p>
		<progress max="100" value={progress}></progress>
		{progress === 100 ? 'Storing…' : `${progress}%`}
	</p>
{/if}

{#if message}
	<p role="alert">{message}</p>
{/if}

<p><a href="/admin">Back to admin</a></p>
