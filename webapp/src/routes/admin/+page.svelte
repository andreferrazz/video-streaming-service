<script lang="ts">
	import { invalidateAll } from '$app/navigation';
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
</script>

<svelte:head>
	<title>Admin</title>
</svelte:head>

<h1>Admin</h1>

<p><a href="/admin/upload">Upload a video</a></p>

<form method="POST" action="?/logout">
	<button>Log out</button>
</form>

{#if form?.error}
	<p role="alert">{form.error}</p>
{/if}

{#if data.videos.length === 0}
	<p>No videos yet.</p>
{:else}
	<table>
		<thead>
			<tr><th>Title</th><th>Status</th><th>Published</th><th></th></tr>
		</thead>
		<tbody>
			{#each data.videos as video (video.id)}
				<tr>
					<td><a href="/admin/videos/{video.id}">{video.title}</a></td>
					<td>
						{#if video.status === 'processing'}
							processing ({video.progress}%)
						{:else if video.status === 'failed'}
							failed: {video.error}
						{:else}
							{video.status}
						{/if}
					</td>
					<td>{video.publishedAt ? 'Yes' : 'No'}</td>
					<td>
						{#if video.status === 'ready'}
							<a href="/watch/{video.slug}">Watch</a>
							<form method="POST" action={video.publishedAt ? '?/unpublish' : '?/publish'}>
								<input type="hidden" name="id" value={video.id} />
								<button>{video.publishedAt ? 'Unpublish' : 'Publish'}</button>
							</form>
						{/if}
					</td>
				</tr>
			{/each}
		</tbody>
	</table>
{/if}

<style>
	td form {
		display: inline;
	}
</style>
