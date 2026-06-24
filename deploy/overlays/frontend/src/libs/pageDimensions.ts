import type { TaskResultMetadata } from './apiTypes'

export interface PageDimensions {
	width: number
	height: number
}

export interface PageSizedSource {
	pageWidth?: number | null
	pageHeight?: number | null
	page_width?: number | null
	page_height?: number | null
}

export const DEFAULT_PAGE_DIMENSIONS: PageDimensions = {
	width: 1654,
	height: 2339,
}

function positiveNumber(value: unknown): number | undefined {
	const parsed = Number(value)
	return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

export function resolvePageDimensions(
	pageIndex: number | null | undefined,
	metadata: TaskResultMetadata | null | undefined,
	source?: PageSizedSource | null,
): PageDimensions {
	const sourceWidth = positiveNumber(source?.pageWidth ?? source?.page_width)
	const sourceHeight = positiveNumber(source?.pageHeight ?? source?.page_height)
	if (sourceWidth && sourceHeight) {
		return { width: sourceWidth, height: sourceHeight }
	}

	const normalizedPageIndex = positiveNumber(pageIndex) ?? 1
	const pageSize = metadata?.page_sizes?.find(entry => entry.page_index === normalizedPageIndex)
	const pageWidth = positiveNumber(pageSize?.width)
	const pageHeight = positiveNumber(pageSize?.height)
	if (pageWidth && pageHeight) {
		return { width: pageWidth, height: pageHeight }
	}

	const fallbackWidth =
		positiveNumber(metadata?.width) ??
		positiveNumber(metadata?.page_size?.width) ??
		DEFAULT_PAGE_DIMENSIONS.width
	const fallbackHeight =
		positiveNumber(metadata?.height) ??
		positiveNumber(metadata?.page_size?.height) ??
		DEFAULT_PAGE_DIMENSIONS.height

	return { width: fallbackWidth, height: fallbackHeight }
}
