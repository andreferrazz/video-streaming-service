<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { formatBytes, formatDuration } from '#lib/format.ts';
	import { SITE_NAME } from '#lib/site.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	// While something is still moving through the pipeline, reload the list every two seconds.
	const busy = $derived(
		data.videos.some((video) => ['uploading', 'queued', 'processing'].includes(video.status))
	);

	$effect(() => {
		if (!busy) return;
		const timer = setInterval(invalidateAll, 2000);
		return () => clearInterval(timer);
	});

	const published = $derived(data.videos.filter((video) => video.publishedAt).length);
	const usedPercent = $derived(
		Math.min(100, (data.storage.usedBytes / data.storage.limitBytes) * 100)
	);

	const inProgress = $derived(
		data.videos.filter((video) => ['uploading', 'queued', 'processing'].includes(video.status))
			.length
	);
</script>

<svelte:head>
	<title>Admin · {SITE_NAME}</title>
</svelte:head>

<section class="page">
	<header>
		<div>
			<p class="eyebrow">Admin</p>
			<h1>Your library</h1>
		</div>
		<div class="actions">
			<a class="button" href="/admin/upload">
				<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 16V5m0 0l-4.5 4.5M12 5l4.5 4.5M5 19h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg>
				Upload
			</a>
			<form method="POST" action="?/logout">
				<button class="button ghost">Sign out</button>
			</form>
		</div>
	</header>

	<dl class="stats">
		<div><dt>Videos</dt><dd>{data.videos.length}</dd></div>
		<div><dt>Published</dt><dd>{published}</dd></div>
		<div><dt>In progress</dt><dd>{inProgress}</dd></div>
		<div class="usage">
			<dt>Storage</dt>
			<dd>
				{formatBytes(data.storage.usedBytes)}
				<small>of {formatBytes(data.storage.limitBytes)}</small>
			</dd>
			<div class="meter" aria-hidden="true"><span style:width="{usedPercent}%"></span></div>
		</div>
	</dl>

	{#if form?.error}
		<p class="notice error" role="alert">{form.error}</p>
	{/if}

	{#if data.videos.length === 0}
		<div class="card empty">
			<h2>No videos yet.</h2>
			<p class="muted">Upload your first one and it will show up here while it is processed.</p>
			<a class="button" href="/admin/upload">Upload a video</a>
		</div>
	{:else}
		<ul class="card list">
			{#each data.videos as video (video.id)}
				<li>
					<a class="thumb" href="/admin/videos/{video.id}" tabindex="-1" aria-hidden="true">
						{#if video.status === 'ready'}
							<img src="/media/{video.id}/poster-small.webp" alt="" width="160" height="90" loading="lazy" />
						{/if}
					</a>

					<div class="info">
						<a class="title" href="/admin/videos/{video.id}">{video.title}</a>
						<div class="state">
							{#if video.status === 'ready'}
								<span class="pill ready">Ready</span>
								{#if video.publishedAt}
									<span class="pill live">Published</span>
								{:else}
									<span class="pill">Draft</span>
								{/if}
								{#if video.durationSeconds !== null}
									<span class="length">{formatDuration(video.durationSeconds)}</span>
								{/if}
							{:else if video.status === 'processing'}
								<span class="pill busy">Processing {video.progress}%</span>
							{:else if video.status === 'failed'}
								<span class="pill failed">Failed</span>
								<span class="reason" title={video.error}>{video.error}</span>
							{:else if video.status === 'queued'}
								<span class="pill busy">Queued</span>
							{:else}
								<span class="pill busy">Uploading</span>
							{/if}
						</div>
						{#if video.status === 'processing'}
							<div class="meter" aria-hidden="true"><span style:width="{video.progress}%"></span></div>
						{/if}
					</div>

					<div class="row-actions">
						{#if video.status === 'ready'}
							<a class="button ghost small" href="/watch/{video.slug}">Watch</a>
							<form method="POST" action={video.publishedAt ? '?/unpublish' : '?/publish'} use:enhance>
								<input type="hidden" name="id" value={video.id} />
								<button class="button small" class:ghost={video.publishedAt !== null}>
									{video.publishedAt ? 'Unpublish' : 'Publish'}
								</button>
							</form>
						{/if}
						<a class="button ghost small" href="/admin/videos/{video.id}">Edit</a>
					</div>
				</li>
			{/each}
		</ul>
	{/if}
</section>

<style>
	section {
		display: grid;
		gap: 1.75rem;
		padding-top: clamp(2rem, 5vw, 3.5rem);
	}

	header {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		justify-content: space-between;
		gap: 1.25rem;
	}

	h1 {
		margin-top: 0.4rem;
		font-size: clamp(2.4rem, 5vw, 3.6rem);
	}

	.actions {
		display: flex;
		gap: 0.75rem;
	}

	.stats {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: 1rem;
		margin: 0;
	}

	.stats > div {
		padding: 1.1rem 1.25rem;
		border: 1px solid var(--line);
		border-radius: var(--radius-m);
		background: rgb(255 255 255 / 0.025);
	}

	dt {
		font-size: 0.8rem;
		color: var(--text-muted);
	}

	dd {
		margin: 0.15rem 0 0;
		font-family: var(--font-display);
		font-size: 2.4rem;
		line-height: 1;
		font-variant-numeric: tabular-nums;
	}

	dd small {
		font-family: var(--font-sans);
		font-size: 0.85rem;
		color: var(--text-muted);
		white-space: nowrap;
	}

	.usage .meter {
		margin-top: 0.7rem;
	}

	.list {
		list-style: none;
		margin: 0;
		padding: 0;
		overflow: hidden;
	}

	li {
		display: grid;
		grid-template-columns: 8rem minmax(0, 1fr) auto;
		align-items: center;
		gap: 1.25rem;
		padding: 1rem 1.25rem;
		transition: background 0.2s var(--ease);
	}

	li + li {
		border-top: 1px solid var(--line);
	}

	li:hover {
		background: rgb(255 255 255 / 0.025);
	}

	.thumb {
		display: block;
		aspect-ratio: 16 / 9;
		overflow: hidden;
		border-radius: var(--radius-s);
		background:
			repeating-linear-gradient(135deg, rgb(255 255 255 / 0.04) 0 8px, transparent 8px 16px),
			var(--surface-raised);
		box-shadow: 0 0 0 1px var(--line);
	}

	.thumb img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.info {
		display: grid;
		gap: 0.5rem;
		min-width: 0;
	}

	.title {
		font-size: 1.05rem;
		font-weight: 500;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.title:hover {
		color: var(--accent-strong);
	}

	.state {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
		min-width: 0;
	}

	.length {
		color: var(--text-faint);
		font-size: 0.82rem;
		font-variant-numeric: tabular-nums;
	}

	.reason {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--text-muted);
		font-size: 0.82rem;
	}

	.meter {
		max-width: 22rem;
	}

	.row-actions {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.empty {
		display: grid;
		justify-items: center;
		gap: 0.8rem;
		padding: clamp(2.5rem, 8vw, 4.5rem) 1.5rem;
		text-align: center;
	}

	.empty h2 {
		font-size: 2rem;
	}

	.empty .button {
		margin-top: 0.6rem;
	}

	@media (max-width: 720px) {
		li {
			grid-template-columns: 5.5rem minmax(0, 1fr);
		}

		.row-actions {
			grid-column: 1 / -1;
			flex-wrap: wrap;
		}

		.stats {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}

		.stats > div {
			padding: 0.85rem 1rem;
		}

		dd {
			font-size: 1.9rem;
		}
	}
</style>
