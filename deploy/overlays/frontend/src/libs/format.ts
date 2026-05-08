export function formatFileSize(bytes: number): string {
	if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
	if (bytes < 1024) return `${bytes} B`
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
	if (bytes < 1024 * 1024 * 1024) {
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
	}
	return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

export function formatDuration(seconds: number | undefined | null): string {
	if (seconds === undefined || seconds === null || !Number.isFinite(seconds)) {
		return '—'
	}
	if (seconds < 1) return `${(seconds * 1000).toFixed(0)} ms`
	if (seconds < 60) return `${seconds.toFixed(1)} s`
	const mins = Math.floor(seconds / 60)
	const rest = Math.round(seconds - mins * 60)
	return `${mins}m ${rest}s`
}

export function formatRelativeTime(timestamp: number | undefined | null): string {
	if (!timestamp) return ''
	const delta = Date.now() - timestamp
	if (delta < 60_000) return '刚刚'
	if (delta < 3_600_000) return `${Math.floor(delta / 60_000)} 分钟前`
	if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)} 小时前`
	const days = Math.floor(delta / 86_400_000)
	if (days < 7) return `${days} 天前`
	return new Date(timestamp).toLocaleDateString()
}
