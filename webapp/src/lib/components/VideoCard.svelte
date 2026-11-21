<script lang="ts">
	import { formatDuration } from '#lib/format.ts';

	interface Props {
		video: { id: string; slug: string; title: string; durationSeconds: number | null };
	}

	let { video }: Props = $props();
</script>

<a class="card-link" href="/watch/{video.slug}">
	<!-- The poster shares a transition name with the player, so it grows into it on navigation. -->
	<div class="poster" style:view-transition-name="video-{video.id}">
		<img src="/media/{video.id}/poster-small.webp" alt="" width="640" height="360" loading="lazy" />
		<span class="play" aria-hidden="true">
			<svg viewBox="0 0 24 24" width="22" height="22"><path d="M8 5.5v13l11-6.5z" fill="currentColor" /></svg>
		</span>
		{#if video.durationSeconds !== null}
			<span class="duration">{formatDuration(video.durationSeconds)}</span>
		{/if}
	</div>
	<h3>{video.title}</h3>
</a>

<style>
	.card-link {
		display: grid;
		gap: 0.8rem;
	}

	.poster {
		position: relative;
		aspect-ratio: 16 / 9;
		overflow: hidden;
		border-radius: var(--radius-m);
		background: var(--surface-raised);
		box-shadow:
			0 0 0 1px var(--line),
			0 20px 40px -24px rgb(0 0 0 / 0.9);
		transition:
			transform 0.35s var(--ease),
			box-shadow 0.35s var(--ease);
	}

	img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		transition: transform 0.6s var(--ease);
	}

	.play {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		background: radial-gradient(circle, rgb(0 0 0 / 0.45), rgb(0 0 0 / 0.1) 60%);
		color: var(--accent-ink);
		opacity: 0;
		transition: opacity 0.25s var(--ease);
	}

	.play svg {
		box-sizing: content-box;
		padding: 0.95rem;
		border-radius: 50%;
		background: var(--accent);
		transform: scale(0.85);
		transition: transform 0.3s var(--ease);
	}

	.duration {
		position: absolute;
		right: 0.6rem;
		bottom: 0.6rem;
		padding: 0.15rem 0.5rem;
		border-radius: 6px;
		background: rgb(0 0 0 / 0.72);
		backdrop-filter: blur(6px);
		font-size: 0.78rem;
		font-weight: 500;
		font-variant-numeric: tabular-nums;
	}

	h3 {
		font-size: 1.02rem;
		font-weight: 500;
		line-height: 1.3;
		color: var(--text);
		transition: color 0.2s var(--ease);
	}

	.card-link:hover .poster,
	.card-link:focus-visible .poster {
		transform: translateY(-4px);
		box-shadow:
			0 0 0 1px rgb(255 180 84 / 0.5),
			0 28px 50px -24px rgb(0 0 0 / 0.95);
	}

	.card-link:hover img,
	.card-link:focus-visible img {
		transform: scale(1.04);
	}

	.card-link:hover .play,
	.card-link:focus-visible .play {
		opacity: 1;
	}

	.card-link:hover .play svg,
	.card-link:focus-visible .play svg {
		transform: scale(1);
	}

	.card-link:hover h3 {
		color: var(--accent-strong);
	}
</style>
