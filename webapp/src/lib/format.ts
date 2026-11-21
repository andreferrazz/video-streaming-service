/** 75 -> "1:15", 3725 -> "1:02:05". Returns an empty string when the length is unknown. */
export function formatDuration(seconds: number | null | undefined) {
	if (seconds === null || seconds === undefined) return '';

	const hours = Math.floor(seconds / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);
	const rest = String(seconds % 60).padStart(2, '0');

	return hours > 0
		? `${hours}:${String(minutes).padStart(2, '0')}:${rest}`
		: `${minutes}:${rest}`;
}

/** "PT10M35S", the machine-readable form for <time datetime>. */
export function isoDuration(seconds: number) {
	return `PT${Math.floor(seconds / 60)}M${seconds % 60}S`;
}

const dateFormat = new Intl.DateTimeFormat('en', {
	day: 'numeric',
	month: 'long',
	year: 'numeric',
	// Fixed zone so the server and the browser print the same text.
	timeZone: 'UTC'
});

export function formatDate(date: Date) {
	return dateFormat.format(date);
}

/** 8_300_000 -> "8.3 MB", 1_250_000_000 -> "1.3 GB". Decimal units, as storage is sold. */
export function formatBytes(bytes: number) {
	const units = ['B', 'KB', 'MB', 'GB', 'TB'];
	let value = bytes;
	let unit = 0;
	while (value >= 1000 && unit < units.length - 1) {
		value /= 1000;
		unit++;
	}
	// One decimal for small numbers, none once there are three digits or for bytes.
	const digits = unit === 0 || value >= 100 || Number.isInteger(value) ? 0 : 1;
	return `${value.toFixed(digits)} ${units[unit]}`;
}
