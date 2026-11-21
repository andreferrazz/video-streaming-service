<script lang="ts">
	import VideoCard from '#lib/components/VideoCard.svelte';
	import { formatDuration } from '#lib/format.ts';
	import { SITE_NAME } from '#lib/site.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	// The newest video gets the stage; everything else goes in the grid below it.
	const featured = $derived(data.videos[0]);
	const rest = $derived(data.videos.slice(1));
</script>

<svelte:head>
	<title>{SITE_NAME}</title>
	<meta name="description" content="Watch the latest videos on {SITE_NAME}." />
</svelte:head>

{#if featured}
	<section class="hero">
		<img class="backdrop" src="/media/{featured.id}/poster.webp" alt="" aria-hidden="true" />

		<div class="page hero-inner">
			<div class="copy">
				<p class="eyebrow">Latest</p>
				<h1>{featured.title}</h1>
				{#if featured.description}
					<p class="description">{featured.description}</p>
				{/if}
				<div class="actions">
					<a class="button" href="/watch/{featured.slug}">
						<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M8 5.5v13l11-6.5z" fill="currentColor" /></svg>
						Play
					</a>
					{#if featured.durationSeconds !== null}
						<span class="length">{formatDuration(featured.durationSeconds)}</span>
					{/if}
				</div>
			</div>

			<a class="stage" href="/watch/{featured.slug}" tabindex="-1" aria-hidden="true">
				<img
					src="/media/{featured.id}/poster.webp"
					alt=""
					width="1280"
					height="720"
					style:view-transition-name="video-{featured.id}"
				/>
			</a>
		</div>
	</section>

	{#if rest.length > 0}
		<section class="page shelf">
			<h2>More to watch</h2>
			<ul>
				{#each rest as video (video.id)}
					<li><VideoCard {video} /></li>
				{/each}
			</ul>
		</section>
	{/if}
{:else}
	<section class="page empty">
		<div class="reel" aria-hidden="true"></div>
		<h1>Nothing is showing yet.</h1>
		<p class="muted">Videos will appear here as soon as the first one is published.</p>
	</section>
{/if}

<style>
	.hero {
		position: relative;
		isolation: isolate;
		overflow: hidden;
		border-bottom: 1px solid var(--line);
	}

	/* The poster, blurred and darkened, washes the whole hero in the video's own colours. */
	.backdrop {
		position: absolute;
		inset: -10%;
		z-index: -2;
		width: 120%;
		height: 120%;
		max-width: none;
		object-fit: cover;
		filter: blur(60px) saturate(140%);
		opacity: 0.55;
	}

	.hero::after {
		content: '';
		position: absolute;
		inset: 0;
		z-index: -1;
		background:
			linear-gradient(90deg, var(--bg) 0%, rgb(11 10 13 / 0.75) 45%, rgb(11 10 13 / 0.35) 100%),
			linear-gradient(0deg, var(--bg) 0%, transparent 45%);
	}

	.hero-inner {
		display: grid;
		grid-template-columns: minmax(0, 5fr) minmax(0, 6fr);
		align-items: center;
		gap: clamp(2rem, 5vw, 4.5rem);
		padding-block: clamp(3rem, 9vw, 6.5rem);
	}

	.copy {
		display: grid;
		gap: 1.2rem;
		justify-items: start;
	}

	h1 {
		font-size: clamp(2.8rem, 6.4vw, 5.4rem);
	}

	.description {
		max-width: 34rem;
		color: var(--text-muted);
		font-size: 1.08rem;
		display: -webkit-box;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 3;
		line-clamp: 3;
		overflow: hidden;
	}

	.actions {
		display: flex;
		align-items: center;
		gap: 1.1rem;
		margin-top: 0.5rem;
	}

	.actions .button {
		padding: 0.85rem 1.6rem;
		font-size: 1rem;
	}

	.length {
		color: var(--text-muted);
		font-variant-numeric: tabular-nums;
	}

	.stage {
		display: block;
		border-radius: var(--radius-l);
		transform: perspective(1400px) rotateY(-5deg);
		transform-origin: right center;
		transition: transform 0.6s var(--ease);
	}

	.stage:hover {
		transform: perspective(1400px) rotateY(0deg) scale(1.01);
	}

	.stage img {
		width: 100%;
		height: auto;
		aspect-ratio: 16 / 9;
		object-fit: cover;
		border-radius: var(--radius-l);
		box-shadow:
			0 0 0 1px var(--line-strong),
			0 40px 80px -30px rgb(0 0 0 / 0.95);
	}

	.shelf {
		padding-top: clamp(2.5rem, 6vw, 4rem);
	}

	h2 {
		font-size: clamp(1.7rem, 3vw, 2.2rem);
		margin-bottom: 1.5rem;
	}

	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(100%, 17.5rem), 1fr));
		gap: 2rem 1.5rem;
	}

	.empty {
		display: grid;
		justify-items: center;
		gap: 1rem;
		padding-block: clamp(5rem, 16vh, 10rem);
		text-align: center;
	}

	.empty h1 {
		font-size: clamp(2.2rem, 5vw, 3.4rem);
	}

	/* A film reel drawn with gradients: a ring with six holes. */
	.reel {
		width: 5.5rem;
		aspect-ratio: 1;
		margin-bottom: 0.5rem;
		border-radius: 50%;
		border: 2px solid var(--line-strong);
		background:
			radial-gradient(circle at 50% 50%, var(--accent) 0 9%, transparent 10%),
			radial-gradient(circle at 50% 20%, var(--line-strong) 0 9%, transparent 10%),
			radial-gradient(circle at 50% 80%, var(--line-strong) 0 9%, transparent 10%),
			radial-gradient(circle at 24% 35%, var(--line-strong) 0 9%, transparent 10%),
			radial-gradient(circle at 76% 35%, var(--line-strong) 0 9%, transparent 10%),
			radial-gradient(circle at 24% 65%, var(--line-strong) 0 9%, transparent 10%),
			radial-gradient(circle at 76% 65%, var(--line-strong) 0 9%, transparent 10%);
		animation: spin 14s linear infinite;
	}

	@keyframes spin {
		to {
			rotate: 360deg;
		}
	}

	@media (max-width: 820px) {
		.hero-inner {
			grid-template-columns: minmax(0, 1fr);
		}

		.stage {
			order: -1;
			transform: none;
		}

		.stage:hover {
			transform: none;
		}
	}
</style>
