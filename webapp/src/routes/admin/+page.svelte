<script lang="ts">
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<h1>Admin</h1>

<form method="POST" action="?/logout">
	<button>Log out</button>
</form>

{#if data.videos.length === 0}
	<p>No videos yet.</p>
{:else}
	<table>
		<thead>
			<tr><th>Title</th><th>Status</th><th>Published</th></tr>
		</thead>
		<tbody>
			{#each data.videos as video (video.id)}
				<tr>
					<td>{video.title}</td>
					<td>{video.status}</td>
					<td>{video.publishedAt ? 'Yes' : 'No'}</td>
				</tr>
			{/each}
		</tbody>
	</table>
{/if}
