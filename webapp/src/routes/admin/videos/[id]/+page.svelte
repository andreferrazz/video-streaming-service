<script lang="ts">
	import { enhance } from '$app/forms';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	function confirmDelete(event: MouseEvent) {
		if (!confirm(`Delete "${data.video.title}" and all its files? This cannot be undone.`)) {
			event.preventDefault();
		}
	}
</script>

<svelte:head>
	<title>Edit: {data.video.title}</title>
</svelte:head>

<p><a href="/admin">Back to admin</a></p>

<h1>Edit video</h1>

<p>
	Status: {data.video.status}{data.video.published ? ', published' : ''}
	{#if data.video.status === 'ready'}
		· <a href="/watch/{data.video.slug}">Watch</a>
	{/if}
</p>

{#if data.video.status === 'failed'}
	<p role="alert">Processing failed: {data.video.error}</p>
	<form method="POST" action="?/retry">
		<button>Try again</button>
	</form>
{/if}

{#if form?.error}
	<p role="alert">{form.error}</p>
{/if}
{#if form?.saved}
	<p role="status">Saved.</p>
{/if}

<form method="POST" action="?/save" use:enhance>
	<label>
		Title
		<input name="title" value={data.video.title} required maxlength="200" />
	</label>
	<label>
		Description
		<textarea name="description" rows="6" maxlength="5000">{data.video.description}</textarea>
	</label>
	<button>Save</button>
</form>

<h2>Delete</h2>

<form method="POST" action="?/delete">
	<button onclick={confirmDelete}>Delete this video</button>
</form>

<style>
	label {
		display: block;
		margin-bottom: 1rem;
	}

	input,
	textarea {
		display: block;
		width: 100%;
		max-width: 40rem;
	}
</style>
