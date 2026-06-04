import type { CopyableTable, TableCell, TableRow } from './tableTypes'

export function rowsToCopyableTable(rows: TableRow[], source: CopyableTable['source']): CopyableTable {
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

export function normalizedAlign(value?: string | null): TableCell['align'] | undefined {
	const normalized = (value || '').trim().toLowerCase()
	if (normalized === 'center' || normalized === 'right') return normalized
	if (normalized === 'left') return 'left'
	return undefined
}

export function positiveInteger(value: string | null): number | undefined {
	const parsed = Number(value)
	return Number.isInteger(parsed) && parsed > 1 ? parsed : undefined
}

export function normalizeCellText(text: string): string {
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
