<script lang="ts">
	import { page } from '$app/state';
	import { SITE_NAME } from '#lib/site.ts';

	const notFound = $derived(page.status === 404);
</script>

<svelte:head>
	<title>{notFound ? 'Not found' : 'Something went wrong'} · {SITE_NAME}</title>
</svelte:head>

<section class="page">
	<p class="code" aria-hidden="true">{page.status}</p>
	<h1>{notFound ? 'This reel is missing.' : 'The projector jammed.'}</h1>
	<p class="muted">
		{notFound
			? 'The page or video you asked for does not exist, or is no longer published.'
			: (page.error?.message ?? 'An unexpected error stopped this page from loading.')}
	</p>
	<a class="button" href="/">Back to all videos</a>
</section>

<style>
	section {
		display: grid;
		justify-items: center;
		gap: 1.1rem;
		padding-block: clamp(4rem, 14vh, 9rem);
		text-align: center;
	}

	.code {
		font-family: var(--font-display);
		font-size: clamp(6rem, 22vw, 13rem);
		line-height: 0.85;
		background: linear-gradient(180deg, var(--accent), transparent 95%);
		background-clip: text;
		-webkit-background-clip: text;
		color: transparent;
	}

	h1 {
		font-size: clamp(2rem, 5vw, 3.2rem);
	}

	.muted {
		max-width: 34rem;
	}

	.button {
		margin-top: 0.8rem;
	}
</style>
