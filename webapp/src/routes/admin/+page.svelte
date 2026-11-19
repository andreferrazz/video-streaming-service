<script lang="ts">
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
</script>

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
					<td>
						{#if video.status === 'ready'}
							<a href="/watch/{video.slug}">{video.title}</a>
						{:else}
							{video.title}
						{/if}
					</td>
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
