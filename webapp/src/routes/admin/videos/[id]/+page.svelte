<script lang="ts">
	import { enhance } from '$app/forms';
	import { SITE_NAME } from '#lib/site.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	function confirmDelete(event: MouseEvent) {
		if (!confirm(`Delete "${data.video.title}" and all its files? This cannot be undone.`)) {
			event.preventDefault();
		}
	}
</script>

<svelte:head>
	<title>Edit: {data.video.title} · {SITE_NAME}</title>
</svelte:head>

<section class="page">
	<a class="back" href="/admin">← Library</a>

	<header>
		<h1>{data.video.title}</h1>
		<div class="state">
			{#if data.video.status === 'ready'}
				<span class="pill ready">Ready</span>
				<span class="pill" class:live={data.video.published}>
					{data.video.published ? 'Published' : 'Draft'}
				</span>
			{:else if data.video.status === 'failed'}
				<span class="pill failed">Failed</span>
			{:else}
				<span class="pill busy">{data.video.status}</span>
			{/if}
		</div>
	</header>

	<div class="layout">
		<div class="main">
			{#if data.video.status === 'failed'}
				<div class="notice error" role="alert">
					<p><strong>Processing failed.</strong> {data.video.error}</p>
					<form method="POST" action="?/retry">
						<button class="button small">Try again</button>
					</form>
				</div>
			{/if}

			{#if form?.error}
				<p class="notice error" role="alert">{form.error}</p>
			{/if}
			{#if form?.saved}
				<p class="notice success" role="status">Saved.</p>
			{/if}

			<form class="card details" method="POST" action="?/save" use:enhance>
				<label class="field">
					<span>Title</span>
					<input class="input" name="title" value={data.video.title} required maxlength="200" />
				</label>
				<label class="field">
					<span>Description</span>
					<textarea class="input" name="description" rows="7" maxlength="5000"
						>{data.video.description}</textarea
					>
				</label>
				<div><button class="button">Save changes</button></div>
			</form>

			<div class="card danger-zone">
				<div>
					<h2>Delete this video</h2>
					<p class="muted">Removes the original, every converted file and the page. There is no undo.</p>
				</div>
				<form method="POST" action="?/delete">
					<button class="button danger" onclick={confirmDelete}>Delete</button>
				</form>
			</div>
		</div>

		<aside>
			<div class="preview">
				{#if data.video.status === 'ready'}
					<img src="/media/{data.video.id}/poster-small.webp" alt="" width="640" height="360" />
				{:else}
					<span class="muted">No preview yet</span>
				{/if}
			</div>
			{#if data.video.status === 'ready'}
				<a class="button ghost" href="/watch/{data.video.slug}">Open watch page</a>
			{/if}
		</aside>
	</div>
</section>

<style>
	section {
		display: grid;
		gap: 1.25rem;
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

	header {
		display: grid;
		gap: 0.8rem;
	}

	h1 {
		font-size: clamp(2.2rem, 5vw, 3.2rem);
		overflow-wrap: anywhere;
	}

	.state {
		display: flex;
		gap: 0.5rem;
	}

	.pill.busy {
		text-transform: capitalize;
	}

	.layout {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 20rem);
		align-items: start;
		gap: clamp(1.5rem, 4vw, 2.5rem);
		margin-top: 0.5rem;
	}

	.main {
		display: grid;
		gap: 1.25rem;
	}

	.details {
		display: grid;
		gap: 1.3rem;
		padding: clamp(1.25rem, 4vw, 2rem);
	}

	.notice.error:has(form) {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem 1.5rem;
	}

	.notice p {
		overflow-wrap: anywhere;
	}

	.danger-zone {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 1rem 2rem;
		padding: 1.25rem clamp(1.25rem, 4vw, 2rem);
		border-color: rgb(255 122 107 / 0.22);
	}

	h2 {
		font-family: var(--font-sans);
		font-size: 1.02rem;
		font-weight: 600;
		letter-spacing: 0;
		line-height: 1.4;
	}

	.danger-zone p {
		font-size: 0.9rem;
	}

	aside {
		display: grid;
		gap: 0.9rem;
	}

	.preview {
		display: grid;
		place-items: center;
		aspect-ratio: 16 / 9;
		overflow: hidden;
		border-radius: var(--radius-m);
		background:
			repeating-linear-gradient(135deg, rgb(255 255 255 / 0.04) 0 8px, transparent 8px 16px),
			var(--surface-raised);
		box-shadow: 0 0 0 1px var(--line);
		font-size: 0.9rem;
	}

	.preview img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	@media (max-width: 820px) {
		.layout {
			grid-template-columns: minmax(0, 1fr);
		}

		aside {
			order: -1;
		}
	}
</style>
