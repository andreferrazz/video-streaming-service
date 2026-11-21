<script lang="ts">
	import type Hls from 'hls.js';
	import VideoCard from '#lib/components/VideoCard.svelte';
	import { formatDate, formatDuration, isoDuration } from '#lib/format.ts';
	import { SITE_NAME } from '#lib/site.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	let player: HTMLVideoElement;
	let hls: Hls | undefined;

	// Quality levels offered by the stream, best first. Empty until the stream has loaded,
	// and stays empty where the browser plays HLS by itself and picks the quality alone.
	let levels = $state<{ index: number; height: number }[]>([]);
	let chosen = $state(-1); // -1 lets the player decide
	let playing = $state<number | null>(null); // height on screen right now

	const base = $derived(`/media/${data.video.id}`);

	$effect(() => {
		const source = `${base}/master.m3u8`;
		let cancelled = false;

		// hls.js is large and only needed here, so it is loaded on demand.
		import('hls.js').then(({ default: Hls }) => {
			if (cancelled) return;

			if (Hls.isSupported()) {
				const instance = new Hls({
					// Fetch the playlists now, but no video until the visitor asks for it.
					// Opening a page and leaving then costs a few kilobytes, not tens of megabytes.
					autoStartLoad: false,
					// Keep half a minute ready ahead of the playhead and no more. The default
					// lets the buffer grow to ten minutes on a fast connection.
					maxBufferLength: 30,
					maxMaxBufferLength: 30
				});
				hls = instance;

				// Pressing play or dragging the timeline is the visitor asking for video.
				const start = () => instance.startLoad();
				player.addEventListener('play', start, { once: true });
				player.addEventListener('seeking', start, { once: true });

				instance.on(Hls.Events.MANIFEST_PARSED, (_event, manifest) => {
					levels = manifest.levels
						.map((level, index) => ({ index, height: level.height }))
						.sort((a, b) => b.height - a.height);
				});
				instance.on(Hls.Events.LEVEL_SWITCHED, (_event, { level }) => {
					playing = instance.levels[level]?.height ?? null;
				});

				instance.loadSource(source);
				instance.attachMedia(player);
			} else {
				// iPhone Safari cannot run hls.js but plays HLS by itself.
				player.src = source;
			}
		});

		return () => {
			cancelled = true;
			hls?.destroy();
			hls = undefined;
			levels = [];
			chosen = -1;
			playing = null;
		};
	});

	function chooseQuality(event: Event) {
		chosen = Number((event.currentTarget as HTMLSelectElement).value);
		if (hls) hls.currentLevel = chosen;
	}
</script>

<svelte:head>
	<title>{data.video.title} · {SITE_NAME}</title>
	{#if data.video.description}
		<meta name="description" content={data.video.description} />
	{/if}
</svelte:head>

<article class="page">
	<div class="player" style:view-transition-name="video-{data.video.id}">
		<!-- svelte-ignore a11y_media_has_caption -->
		<video bind:this={player} controls playsinline preload="none" poster="{base}/poster.webp"></video>
	</div>

	<div class="details">
		<div class="heading">
			<h1>{data.video.title}</h1>

			{#if levels.length > 1}
				<label class="quality">
					<span class="visually-hidden">Quality</span>
					<select value={chosen} onchange={chooseQuality}>
						<option value={-1}>Auto{chosen === -1 && playing ? ` (${playing}p)` : ''}</option>
						{#each levels as level (level.index)}
							<option value={level.index}>{level.height}p</option>
						{/each}
					</select>
				</label>
			{/if}
		</div>

		<p class="meta">
			{#if data.video.publishedAt}
				<time datetime={data.video.publishedAt.toISOString()}>{formatDate(data.video.publishedAt)}</time>
			{:else}
				<span class="pill live">Preview · not published</span>
			{/if}
			{#if data.video.durationSeconds !== null}
				<span aria-hidden="true">·</span>
				<time datetime={isoDuration(data.video.durationSeconds)}>
					{formatDuration(data.video.durationSeconds)}
				</time>
			{/if}
		</p>

		{#if data.video.description}
			<p class="description">{data.video.description}</p>
		{/if}
	</div>
</article>

{#if data.more.length > 0}
	<section class="page shelf">
		<h2>More to watch</h2>
		<ul>
			{#each data.more as video (video.id)}
				<li><VideoCard {video} /></li>
			{/each}
		</ul>
	</section>
{/if}

<style>
	article {
		padding-top: clamp(1.25rem, 3vw, 2.5rem);
	}

	.player {
		position: relative;
		aspect-ratio: 16 / 9;
		/* Never taller than the window, so the controls stay on screen. */
		max-width: calc((100dvh - 9rem) * 16 / 9);
		margin-inline: auto;
		border-radius: var(--radius-l);
		overflow: hidden;
		background: black;
		box-shadow:
			0 0 0 1px var(--line),
			0 50px 120px -40px rgb(255 180 84 / 0.22),
			0 40px 80px -30px rgb(0 0 0 / 0.95);
	}

	video {
		width: 100%;
		height: 100%;
		background: black;
	}

	.details {
		display: grid;
		gap: 0.9rem;
		padding-top: clamp(1.5rem, 3vw, 2.25rem);
	}

	/* Title on the left, quality on the right, lined up with the player's edges. */
	.heading {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem 1.5rem;
	}

	h1 {
		font-size: clamp(2.1rem, 4.6vw, 3.4rem);
	}

	.quality select {
		appearance: none;
		padding: 0.5rem 2.1rem 0.5rem 0.95rem;
		border: 1px solid var(--line-strong);
		border-radius: 999px;
		background:
			url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 8'%3E%3Cpath d='M1 1.5l5 5 5-5' fill='none' stroke='%23a8a19a' stroke-width='1.6' stroke-linecap='round'/%3E%3C/svg%3E")
				no-repeat right 0.8rem center / 0.65rem,
			rgb(255 255 255 / 0.05);
		font-size: 0.85rem;
		font-weight: 500;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
		cursor: pointer;
		transition: border-color 0.2s var(--ease);
	}

	.quality select:hover {
		border-color: rgb(255 255 255 / 0.3);
	}

	.quality option {
		background: var(--surface-raised);
	}

	.meta {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.6rem;
		color: var(--text-muted);
		font-size: 0.95rem;
		font-variant-numeric: tabular-nums;
	}

	.description {
		max-width: 52rem;
		color: #d6d0c8;
		font-size: 1.06rem;
		line-height: 1.65;
		white-space: pre-line;
	}

	.shelf {
		padding-top: clamp(3rem, 7vw, 5rem);
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
</style>
