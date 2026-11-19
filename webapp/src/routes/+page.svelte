<script lang="ts">
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<h1>Videos</h1>

{#if data.videos.length === 0}
	<p>No videos published yet.</p>
{:else}
	<ul>
		{#each data.videos as video (video.slug)}
			<li><a href="/watch/{video.slug}">{video.title}</a></li>
		{/each}
	</ul>
{/if}
