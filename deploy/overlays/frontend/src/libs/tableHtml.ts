import { normalizeCellText, normalizedAlign, positiveInteger, rowsToCopyableTable } from './tableRender'
import type { CopyableTable, TableCell } from './tableTypes'

export function extractHtmlTable(content: string): CopyableTable | null {
	if (typeof document === 'undefined') return null

	const wrapped = wrapHtmlTableFragment(content)
	const host = document.createElement('div')
	host.innerHTML = wrapped
	const table = host.querySelector('table')
	if (!table) return null

	const rows = Array.from(table.querySelectorAll('tr'))
		.map(row => Array.from(row.querySelectorAll('th,td')).map(cellToTableCell))
		.filter(row => row.length > 0)

	if (rows.length === 0) return null
	return rowsToCopyableTable(rows, 'html')
}

export function htmlToPlainText(html: string): string {
	if (typeof document === 'undefined') return html
	const host = document.createElement('div')
	host.innerHTML = html
	const rows = Array.from(host.querySelectorAll('tr'))
	if (rows.length > 0) {
		return rows
			.map(row => Array.from(row.querySelectorAll('th,td')).map(cell => normalizeCellText(cell.textContent || '')).join('\t'))
			.join('\n')
	}
	return normalizeCellText(host.textContent || html)
}

function wrapHtmlTableFragment(content: string): string {
	const trimmed = content.trim()
	if (/<table\b/i.test(trimmed)) return trimmed
	if (/<(thead|tbody|tfoot)\b/i.test(trimmed)) return `<table>${trimmed}</table>`
	if (/<tr\b/i.test(trimmed)) return `<table><tbody>${trimmed}</tbody></table>`
	if (/<(td|th)\b/i.test(trimmed)) return `<table><tbody><tr>${trimmed}</tr></tbody></table>`
	return trimmed
}

function cellToTableCell(cell: Element): TableCell {
	const align = normalizedAlign(cell.getAttribute('align') || (cell as HTMLElement).style?.textAlign)
	const colspan = positiveInteger(cell.getAttribute('colspan'))
	const rowspan = positiveInteger(cell.getAttribute('rowspan'))

	return {
		text: normalizeCellText(cell.textContent || ''),
		tag: cell.tagName.toLowerCase() === 'th' ? 'th' : 'td',
		align,
		colspan,
		rowspan
	}
}
