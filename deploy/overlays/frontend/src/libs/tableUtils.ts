type TableCell = {
	text: string
	tag: 'th' | 'td'
	align?: 'left' | 'center' | 'right'
	colspan?: number
	rowspan?: number
}

type TableRow = TableCell[]

export type CopyableTable = {
	html: string
	plainText: string
	source: 'markdown' | 'html'
}

const TABLE_LAYOUT_RE = /\b(table|tabular)\b/i
const HTML_TABLE_RE = /<(table|thead|tbody|tfoot|tr|td|th)\b/i
const MARKDOWN_SEPARATOR_RE = /^:?-{3,}:?$/

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

export function isMarkdownTable(content: string): boolean {
	return extractMarkdownTable(content) !== null
}

export function markdownTableToHtml(content: string): string {
	return extractMarkdownTable(content)?.html ?? ''
}

export async function copyHtmlToClipboard(html: string, plainText?: string): Promise<boolean> {
	if (!html) return false

	const text = plainText || htmlToPlainText(html)
	try {
		const ClipboardItemCtor = globalThis.ClipboardItem
		if (navigator.clipboard?.write && ClipboardItemCtor && window.isSecureContext) {
			await navigator.clipboard.write([
				new ClipboardItemCtor({
					'text/html': new Blob([html], { type: 'text/html' }),
					'text/plain': new Blob([text], { type: 'text/plain' })
				})
			])
			return true
		}
	} catch (error) {
		console.error('Failed to copy HTML table with Clipboard API:', error)
	}

	if (copyHtmlSelection(html)) return true
	return copyPlainText(text)
}

export async function copyTableToClipboard(table: CopyableTable): Promise<boolean> {
	return copyHtmlToClipboard(table.html, table.plainText)
}

function extractMarkdownTable(content: string): CopyableTable | null {
	const lines = content.split(/\r?\n/)
	for (let i = 0; i < lines.length - 1; i++) {
		const header = lines[i].trim()
		const separator = lines[i + 1].trim()
		if (!header.includes('|') || !isSeparatorRow(separator)) continue

		const tableLines = [header, separator]
		for (let j = i + 2; j < lines.length; j++) {
			const line = lines[j].trim()
			if (!line || !line.includes('|')) break
			tableLines.push(line)
		}

		if (tableLines.length < 3) continue
		const rows = markdownLinesToRows(tableLines)
		if (rows.length >= 2) return rowsToCopyableTable(rows, 'markdown')
	}
	return null
}

function markdownLinesToRows(lines: string[]): TableRow[] {
	const headerCells = splitMarkdownRow(lines[0])
	const alignments = splitMarkdownRow(lines[1]).map(parseAlignment)
	const rows: TableRow[] = [
		headerCells.map((text, index) => ({
			text,
			tag: 'th',
			align: alignments[index]
		}))
	]

	for (const line of lines.slice(2)) {
		const cells = splitMarkdownRow(line)
		rows.push(
			cells.map((text, index) => ({
				text,
				tag: 'td',
				align: alignments[index]
			}))
		)
	}

	return rows
}

function isSeparatorRow(line: string): boolean {
	const cells = splitMarkdownRow(line)
	return cells.length > 0 && cells.every(cell => MARKDOWN_SEPARATOR_RE.test(cell.trim()))
}

function splitMarkdownRow(line: string): string[] {
	const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '')
	const cells: string[] = []
	let current = ''
	let escaped = false

	for (const char of trimmed) {
		if (escaped) {
			current += char
			escaped = false
			continue
		}
		if (char === '\\') {
			escaped = true
			continue
		}
		if (char === '|') {
			cells.push(current.trim())
			current = ''
			continue
		}
		current += char
	}

	cells.push(current.trim())
	return cells
}

function parseAlignment(cell: string): TableCell['align'] {
	const trimmed = cell.trim()
	if (trimmed.startsWith(':') && trimmed.endsWith(':')) return 'center'
	if (trimmed.endsWith(':')) return 'right'
	return 'left'
}

function extractHtmlTable(content: string): CopyableTable | null {
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

function rowsToCopyableTable(rows: TableRow[], source: CopyableTable['source']): CopyableTable {
	return {
		html: rowsToHtml(rows),
		plainText: rowsToPlainText(rows),
		source
	}
}

function rowsToHtml(rows: TableRow[]): string {
	const lines = [
		'<table style="border-collapse: collapse; border: 1px solid #b7b7b7;">'
	]

	for (const row of rows) {
		lines.push('  <tr>')
		for (const cell of row) {
			const tag = cell.tag
			const attrs = [
				'style="border: 1px solid #b7b7b7; padding: 4px 8px; vertical-align: top;"'
			]
			if (cell.align && cell.align !== 'left') attrs.push(`align="${cell.align}"`)
			if (cell.colspan && cell.colspan > 1) attrs.push(`colspan="${cell.colspan}"`)
			if (cell.rowspan && cell.rowspan > 1) attrs.push(`rowspan="${cell.rowspan}"`)
			lines.push(`    <${tag} ${attrs.join(' ')}>${escapeHtml(cell.text)}</${tag}>`)
		}
		lines.push('  </tr>')
	}

	lines.push('</table>')
	return lines.join('\n')
}

function rowsToPlainText(rows: TableRow[]): string {
	return rows.map(row => row.map(cell => cell.text).join('\t')).join('\n')
}

function copyHtmlSelection(html: string): boolean {
	if (typeof document === 'undefined') return false

	const container = document.createElement('div')
	container.contentEditable = 'true'
	container.innerHTML = html
	container.style.position = 'fixed'
	container.style.left = '-9999px'
	container.style.top = '0'
	container.style.pointerEvents = 'none'
	document.body.appendChild(container)

	const selection = window.getSelection()
	const range = document.createRange()
	range.selectNodeContents(container)
	selection?.removeAllRanges()
	selection?.addRange(range)

	try {
		return document.execCommand('copy')
	} catch (error) {
		console.error('Failed to copy HTML table with selection fallback:', error)
		return false
	} finally {
		selection?.removeAllRanges()
		document.body.removeChild(container)
	}
}

function copyPlainText(text: string): boolean {
	if (typeof document === 'undefined') return false

	const textArea = document.createElement('textarea')
	textArea.value = text
	textArea.style.position = 'fixed'
	textArea.style.top = '0'
	textArea.style.left = '0'
	textArea.style.opacity = '0'
	textArea.style.pointerEvents = 'none'
	textArea.setAttribute('readonly', 'true')
	document.body.appendChild(textArea)
	textArea.focus()
	textArea.select()

	try {
		return document.execCommand('copy')
	} catch (error) {
		console.error('Failed to copy table plain text:', error)
		return false
	} finally {
		document.body.removeChild(textArea)
	}
}

function htmlToPlainText(html: string): string {
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

function normalizedAlign(value?: string | null): TableCell['align'] | undefined {
	const normalized = (value || '').trim().toLowerCase()
	if (normalized === 'center' || normalized === 'right') return normalized
	if (normalized === 'left') return 'left'
	return undefined
}

function positiveInteger(value: string | null): number | undefined {
	const parsed = Number(value)
	return Number.isInteger(parsed) && parsed > 1 ? parsed : undefined
}

function normalizeCellText(text: string): string {
	return text.replace(/\s+/g, ' ').trim()
}

function escapeHtml(text: string): string {
	return text.replace(/[&<>"']/g, char => {
		switch (char) {
			case '&': return '&amp;'
			case '<': return '&lt;'
			case '>': return '&gt;'
			case '"': return '&quot;'
			default: return '&#039;'
		}
	})
}
