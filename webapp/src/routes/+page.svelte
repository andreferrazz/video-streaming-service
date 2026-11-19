<script lang="ts">
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>Videos</title>
</svelte:head>

<h1>Videos</h1>

{#if data.videos.length === 0}
	<p>No videos published yet.</p>
{:else}
	<ul>
		{#each data.videos as video (video.id)}
			<li>
				<a href="/watch/{video.slug}">
					<img src="/media/{video.id}/poster.jpg" alt="" width="320" height="180" loading="lazy" />
					{video.title}
				</a>
			</li>
		{/each}
	</ul>
{/if}

<style>
	ul {
		list-style: none;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
		gap: 1rem;
	}

	img {
		display: block;
		width: 100%;
		height: auto;
		aspect-ratio: 16 / 9;
		object-fit: cover;
		background: black;
	}
</style>
