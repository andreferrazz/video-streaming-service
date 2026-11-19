<script lang="ts">
	import type { PageProps } from './$types';

	let { form }: PageProps = $props();
</script>

<h1>Admin login</h1>

<form method="POST">
	<label>
		Password
		<input type="password" name="password" autocomplete="current-password" required />
	</label>
	<button>Log in</button>
</form>

{#if form?.error}
	<p role="alert">{form.error}</p>
{/if}
