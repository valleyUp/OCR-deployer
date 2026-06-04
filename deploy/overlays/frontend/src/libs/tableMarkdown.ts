import { rowsToCopyableTable } from './tableRender'
import type { CopyableTable, TableCell, TableRow } from './tableTypes'

const MARKDOWN_SEPARATOR_RE = /^:?-{3,}:?$/

export function extractMarkdownTable(content: string): CopyableTable | null {
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

export function isMarkdownTable(content: string): boolean {
	return extractMarkdownTable(content) !== null
}

export function markdownTableToHtml(content: string): string {
	return extractMarkdownTable(content)?.html ?? ''
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
