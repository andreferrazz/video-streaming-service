<script lang="ts">
	import { SITE_NAME } from '#lib/site.ts';
	import type { PageProps } from './$types';

	let { form }: PageProps = $props();
</script>

<svelte:head>
	<title>Sign in · {SITE_NAME}</title>
</svelte:head>

<section class="page">
	<form method="POST" class="card">
		<div class="intro">
			<p class="eyebrow">Admin</p>
			<h1>Welcome back.</h1>
			<p class="muted">Sign in to upload and manage videos.</p>
		</div>

		{#if form?.error}
			<p class="notice error" role="alert">{form.error}</p>
		{/if}

		<label class="field">
			<span>Password</span>
			<!-- svelte-ignore a11y_autofocus -->
			<input
				class="input"
				type="password"
				name="password"
				autocomplete="current-password"
				required
				autofocus
			/>
		</label>

		<button class="button">Sign in</button>
	</form>
</section>

<style>
	section {
		display: grid;
		place-items: center;
		padding-block: clamp(3rem, 12vh, 8rem);
	}

	form {
		display: grid;
		gap: 1.4rem;
		width: min(100%, 26rem);
		padding: clamp(1.75rem, 5vw, 2.5rem);
	}

	.intro {
		display: grid;
		gap: 0.5rem;
	}

	h1 {
		font-size: 2.6rem;
	}
</style>
