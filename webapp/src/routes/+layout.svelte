<script lang="ts">
	import '@fontsource-variable/geist';
	import '@fontsource/instrument-serif/400.css';
	import '@fontsource/instrument-serif/400-italic.css';
	import '../app.css';

	import { onNavigate } from '$app/navigation';
	import { navigating, page } from '$app/state';
	import favicon from '#lib/assets/favicon.svg';
	import { SITE_NAME } from '#lib/site.ts';
	import type { LayoutProps } from './$types';

	let { data, children }: LayoutProps = $props();

	const inAdmin = $derived(page.url.pathname.startsWith('/admin'));

	// Cross-fade between pages, and let shared elements (a poster and its player) morph,
	// in browsers that support view transitions. Others simply navigate as usual.
	onNavigate((navigation) => {
		if (!document.startViewTransition) return;

		return new Promise((resolve) => {
			document.startViewTransition(async () => {
				resolve();
				await navigation.complete;
			});
		});
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<meta name="theme-color" content="#0b0a0d" />
</svelte:head>

{#if navigating.to}
	<div class="loading" aria-hidden="true"></div>
{/if}

<a class="skip" href="#content">Skip to content</a>

<header>
	<div class="page bar">
		<a class="brand" href="/" aria-label="{SITE_NAME}, home">
			<span class="mark" aria-hidden="true">
				<svg viewBox="0 0 24 24" width="14" height="14"><path d="M8 5.5v13l11-6.5z" fill="currentColor" /></svg>
			</span>
			<span class="name">{SITE_NAME}</span>
		</a>

		<nav aria-label="Main">
			<a href="/" aria-current={page.url.pathname === '/' ? 'page' : undefined}>Videos</a>
			{#if data.admin}
				<a href="/admin" aria-current={inAdmin ? 'page' : undefined}>Admin</a>
			{/if}
		</nav>
	</div>
</header>

<main id="content">
	{@render children()}
</main>

<footer>
	<div class="page">
		<span>{SITE_NAME}</span>
		{#if !data.admin}
			<a href="/admin/login">Admin</a>
		{/if}
	</div>
</footer>

<style>
	:global(body) {
		display: flex;
		flex-direction: column;
	}

	main {
		flex: 1;
	}

	.skip {
		position: absolute;
		left: 1rem;
		top: -4rem;
		z-index: 30;
		padding: 0.6rem 1rem;
		border-radius: var(--radius-s);
		background: var(--accent);
		color: var(--accent-ink);
		font-weight: 600;
		transition: top 0.2s var(--ease);
	}

	.skip:focus-visible {
		top: 1rem;
	}

	/* A thin bar across the top while the next page is loading. */
	.loading {
		position: fixed;
		inset: 0 0 auto 0;
		z-index: 40;
		height: 2px;
		background: linear-gradient(90deg, transparent, var(--accent), transparent);
		background-size: 40% 100%;
		background-repeat: no-repeat;
		animation: slide 1s linear infinite;
	}

	@keyframes slide {
		from {
			background-position: -40% 0;
		}
		to {
			background-position: 140% 0;
		}
	}

	header {
		position: sticky;
		top: 0;
		z-index: 20;
		border-bottom: 1px solid var(--line);
		background: rgb(11 10 13 / 0.72);
		backdrop-filter: saturate(160%) blur(18px);
		view-transition-name: site-header;
	}

	.bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1.5rem;
		height: 4rem;
	}

	.brand {
		display: inline-flex;
		align-items: center;
		gap: 0.7rem;
	}

	.mark {
		display: grid;
		place-items: center;
		width: 1.9rem;
		height: 1.9rem;
		border-radius: 50%;
		background: var(--accent);
		color: var(--accent-ink);
		box-shadow: 0 0 24px -4px rgb(255 180 84 / 0.7);
		transition: transform 0.3s var(--ease);
	}

	.brand:hover .mark {
		transform: scale(1.08) rotate(-6deg);
	}

	.name {
		font-family: var(--font-display);
		font-size: 1.45rem;
		line-height: 1;
		letter-spacing: -0.01em;
	}

	nav {
		display: flex;
		gap: 0.35rem;
	}

	nav a {
		padding: 0.4rem 0.85rem;
		border-radius: 999px;
		font-size: 0.92rem;
		font-weight: 500;
		color: var(--text-muted);
		transition:
			color 0.2s var(--ease),
			background 0.2s var(--ease);
	}

	nav a:hover {
		color: var(--text);
		background: rgb(255 255 255 / 0.06);
	}

	nav a[aria-current='page'] {
		color: var(--text);
		background: rgb(255 255 255 / 0.09);
	}

	footer {
		margin-top: 5rem;
		border-top: 1px solid var(--line);
		color: var(--text-faint);
		font-size: 0.85rem;
	}

	footer .page {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		padding-block: 1.6rem;
	}

	footer a:hover {
		color: var(--text-muted);
	}
</style>
