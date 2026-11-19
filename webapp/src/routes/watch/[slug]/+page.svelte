<script lang="ts">
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	let player: HTMLVideoElement;

	const base = $derived(`/media/${data.video.id}`);

	$effect(() => {
		const source = `${base}/master.m3u8`;
		let destroy = () => {};
		let cancelled = false;

		// hls.js is large and only needed here, so it is loaded on demand.
		import('hls.js').then(({ default: Hls }) => {
			if (cancelled) return;

			if (Hls.isSupported()) {
				const hls = new Hls();
				hls.loadSource(source);
				hls.attachMedia(player);
				destroy = () => hls.destroy();
			} else {
				// iPhone Safari cannot run hls.js but plays HLS by itself.
				player.src = source;
			}
		});

		return () => {
			cancelled = true;
			destroy();
		};
	});
</script>

<svelte:head>
	<title>{data.video.title}</title>
</svelte:head>

<p><a href="/">All videos</a></p>

<!-- svelte-ignore a11y_media_has_caption -->
<video bind:this={player} controls playsinline poster="{base}/poster.jpg"></video>

<h1>{data.video.title}</h1>

{#if !data.video.published}
	<p><strong>Preview:</strong> this video is not published, so only you can see it.</p>
{/if}

{#if data.video.description}
	<p>{data.video.description}</p>
{/if}

<style>
	video {
		display: block;
		width: 100%;
		max-width: 960px;
		aspect-ratio: 16 / 9;
		background: black;
	}
</style>
