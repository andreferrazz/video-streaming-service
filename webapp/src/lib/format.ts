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
