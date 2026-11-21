import { spawn } from 'node:child_process';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

/** Target heights with the video bitrate cap for each, highest first. */
const LADDER = [
	{ height: 1080, kbps: 5000 },
	{ height: 720, kbps: 2800 },
	{ height: 480, kbps: 1400 },
	{ height: 360, kbps: 800 }
];

const AUDIO_KBPS = 128;
const SEGMENT_SECONDS = 4;

export interface SourceInfo {
	width: number;
	height: number;
	durationSeconds: number;
	hasAudio: boolean;
}

/** Run a program and resolve with its stdout, or reject with the end of its stderr. */
function run(
	command: string,
	args: string[],
	signal: AbortSignal,
	onLine?: (line: string) => void
) {
	return new Promise<string>((resolve, reject) => {
		const child = spawn(command, args, { signal, stdio: ['ignore', 'pipe', 'pipe'] });
		let stdout = '';
		let stderr = '';

		if (onLine) {
			createInterface({ input: child.stdout }).on('line', onLine);
		} else {
			child.stdout.on('data', (chunk) => (stdout += chunk));
		}
		child.stderr.on('data', (chunk) => (stderr = (stderr + chunk).slice(-2000)));

		child.on('error', reject);
		child.on('close', (code) => {
			if (code === 0) resolve(stdout);
			else reject(new Error(`${command} exited with code ${code}: ${stderr.trim()}`));
		});
	});
}

export async function probe(path: string, signal: AbortSignal): Promise<SourceInfo> {
	const output = await run(
		'ffprobe',
		['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', path],
		signal
	);
	const info = JSON.parse(output);
	const video = info.streams?.find((s: { codec_type: string }) => s.codec_type === 'video');
	if (!video) throw new Error('The file has no video stream.');

	return {
		width: video.width,
		height: video.height,
		durationSeconds: Number(info.format?.duration ?? video.duration ?? 0),
		hasAudio: info.streams.some((s: { codec_type: string }) => s.codec_type === 'audio')
	};
}

/** Never upscale: keep the rungs at or below the source, or the source size alone if it is tiny. */
function renditionsFor(source: SourceInfo) {
	const rungs = LADDER.filter((rung) => rung.height <= source.height);
	const chosen = rungs.length > 0 ? rungs : [{ height: source.height, kbps: 800 }];

	return chosen.map((rung) => {
		// Keep the aspect ratio; H.264 needs even dimensions.
		const height = rung.height - (rung.height % 2);
		const width = Math.round((source.width * height) / source.height / 2) * 2;
		return { name: `${rung.height}p`, width, height, kbps: rung.kbps };
	});
}

/**
 * Transcode `input` into HLS under `outDir`: one folder per rendition plus a
 * master playlist that lists them, and the poster images. `onProgress` receives
 * a value from 0 to 100.
 */
export async function transcode(
	input: string,
	outDir: string,
	source: SourceInfo,
	signal: AbortSignal,
	onProgress: (percent: number) => void
) {
	const renditions = renditionsFor(source);
	const master = ['#EXTM3U', '#EXT-X-VERSION:3'];

	for (const [index, rendition] of renditions.entries()) {
		const dir = join(outDir, rendition.name);
		await mkdir(dir, { recursive: true });

		const args = [
			'-y', '-v', 'error', '-nostdin',
			'-i', input,
			'-map', '0:v:0',
			'-vf', `scale=${rendition.width}:${rendition.height}`,
			'-c:v', 'libx264', '-preset', 'veryfast', '-profile:v', 'main', '-pix_fmt', 'yuv420p',
			'-crf', '21',
			'-maxrate', `${rendition.kbps}k`, '-bufsize', `${rendition.kbps * 2}k`,
			// A keyframe exactly every segment, in every rendition, so the player can switch quality at any segment.
			'-force_key_frames', `expr:gte(t,n_forced*${SEGMENT_SECONDS})`,
			'-sc_threshold', '0'
		];

		if (source.hasAudio) {
			args.push('-map', '0:a:0', '-c:a', 'aac', '-b:a', `${AUDIO_KBPS}k`, '-ac', '2');
		}

		args.push(
			'-f', 'hls',
			'-hls_time', String(SEGMENT_SECONDS),
			'-hls_playlist_type', 'vod',
			'-hls_segment_filename', join(dir, 'seg_%05d.ts'),
			'-progress', 'pipe:1',
			join(dir, 'index.m3u8')
		);

		await run('ffmpeg', args, signal, (line) => {
			// ffmpeg reports how far into the video it is, in microseconds.
			const match = /^out_time_us=(\d+)$/.exec(line);
			if (!match || source.durationSeconds <= 0) return;
			const fraction = Math.min(Number(match[1]) / 1_000_000 / source.durationSeconds, 1);
			onProgress(Math.floor(((index + fraction) / renditions.length) * 100));
		});

		const bandwidth = (rendition.kbps + (source.hasAudio ? AUDIO_KBPS : 0)) * 1000;
		master.push(
			`#EXT-X-STREAM-INF:BANDWIDTH=${bandwidth},RESOLUTION=${rendition.width}x${rendition.height}`,
			`${rendition.name}/index.m3u8`
		);
	}

	await writeFile(join(outDir, 'master.m3u8'), master.join('\n') + '\n');

	// Posters: one frame from a second in, or the middle of very short videos.
	await makePosters(input, outDir, Math.min(1, source.durationSeconds / 2), signal);
}

export const POSTER_LARGE = 'poster.webp';
export const POSTER_SMALL = 'poster-small.webp';

/**
 * Write the two poster sizes into `outDir` from one frame of `input`, which may
 * be a video or a still image. `at` is how many seconds in to take the frame.
 */
export async function makePosters(input: string, outDir: string, at: number, signal: AbortSignal) {
	await mkdir(outDir, { recursive: true });
	await run(
		'ffmpeg',
		[
			'-y', '-v', 'error', '-nostdin',
			// Seeking a still image, even to zero, makes ffmpeg produce nothing at all.
			...(at > 0 ? ['-ss', String(at)] : []),
			'-i', input,
			// One decoded frame, scaled twice. Neither size is ever larger than the source.
			'-filter_complex',
			'[0:v]split=2[a][b];[a]scale=-2:min(720\\,ih)[large];[b]scale=-2:min(360\\,ih)[small]',
			'-map', '[large]', '-frames:v', '1', '-c:v', 'libwebp', '-quality', '75',
			join(outDir, POSTER_LARGE),
			'-map', '[small]', '-frames:v', '1', '-c:v', 'libwebp', '-quality', '75',
			join(outDir, POSTER_SMALL)
		],
		signal
	);

	// ffmpeg can exit successfully having written an empty file. Never store one.
	for (const name of [POSTER_LARGE, POSTER_SMALL]) {
		if ((await stat(join(outDir, name))).size === 0) {
			throw new Error(`ffmpeg produced an empty ${name}`);
		}
	}
}
