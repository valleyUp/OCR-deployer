import { copyHtmlToClipboard, copyTableToClipboard } from './tableClipboard'
import { extractHtmlTable } from './tableHtml'
import { extractMarkdownTable, isMarkdownTable, markdownTableToHtml } from './tableMarkdown'
import type { CopyableTable } from './tableTypes'

const TABLE_LAYOUT_RE = /\b(table|tabular)\b/i
const HTML_TABLE_RE = /<(table|thead|tbody|tfoot|tr|td|th)\b/i

export function hasCopyableTable(content: string, layoutType?: string): boolean {
	return extractCopyableTable(content, layoutType) !== null
}

export function extractCopyableTable(content: string, layoutType?: string): CopyableTable | null {
	if (!content || typeof content !== 'string') return null

	if (HTML_TABLE_RE.test(content) || TABLE_LAYOUT_RE.test(layoutType || '')) {
		const htmlTable = extractHtmlTable(content)
		if (htmlTable) return htmlTable
	}

	return extractMarkdownTable(content)
}

export { copyHtmlToClipboard, copyTableToClipboard, isMarkdownTable, markdownTableToHtml }
export type { CopyableTable }
