/**
 * Table utility functions for markdown table detection and HTML conversion
 */

/**
 * Check if content is a markdown table
 * A valid markdown table should have:
 * - At least one header row with | separators
 * - A separator row with |---| pattern
 * - At least one data row
 */
export function isMarkdownTable(content: string): boolean {
	if (!content || typeof content !== 'string') return false

	const lines = content.trim().split('\n').filter(line => line.trim())

	// Need at least 3 lines: header, separator, data
	if (lines.length < 3) return false

	// Check if first line has | separator
	const hasHeader = lines[0].includes('|')
	if (!hasHeader) return false

	// Check if second line is separator (|---|---| or |:---:|:---:|)
	const separatorRegex = /^\|?[\s]*:?-{3,}:?[\s]*(\|[\s]*:?-{3,}:?[\s]*)*\|?$/
	const isSeparator = separatorRegex.test(lines[1].trim())
	if (!isSeparator) return false

	// Check if remaining lines have | separator
	const hasData = lines.slice(2).some(line => line.includes('|'))
	return hasData
}

/**
 * Parse alignment from separator cell
 * :---: -> center, ---: -> right, :--- or --- -> left
 */
function parseAlignment(cell: string): string {
	const trimmed = cell.trim()
	if (trimmed.startsWith(':') && trimmed.endsWith(':')) return 'center'
	if (trimmed.endsWith(':')) return 'right'
	return 'left'
}

/**
 * Parse a markdown table row into cells
 */
function parseRow(line: string): string[] {
	// Remove leading/trailing | and split by |
	const trimmed = line.trim()
	const withoutPipes = trimmed.replace(/^\|/, '').replace(/\|$/, '')
	return withoutPipes.split('|').map(cell => cell.trim())
}

/**
 * Convert markdown table to HTML table string
 * Preserves header, cell structure, and alignment
 */
export function markdownTableToHtml(content: string): string {
	if (!content || typeof content !== 'string') return ''

	const lines = content.trim().split('\n').filter(line => line.trim())

	// Need at least 3 lines: header, separator, data
	if (lines.length < 3) return ''

	// Parse header
	const headerCells = parseRow(lines[0])

	// Parse separator for alignment
	const separatorCells = parseRow(lines[1])
	const alignments = separatorCells.map(cell => parseAlignment(cell))

	// Parse data rows
	const dataRows = lines.slice(2).map(line => parseRow(line))

	// Build HTML table
	let html = '<table>\n'

	// Header
	html += '  <thead>\n    <tr>\n'
	headerCells.forEach((cell, i) => {
		const align = alignments[i] || 'left'
		const alignAttr = align !== 'left' ? ` style="text-align: ${align}"` : ''
		html += `      <th${alignAttr}>${escapeHtml(cell)}</th>\n`
	})
	html += '    </tr>\n  </thead>\n'

	// Body
	html += '  <tbody>\n'
	dataRows.forEach(row => {
		html += '    <tr>\n'
		row.forEach((cell, i) => {
			const align = alignments[i] || 'left'
			const alignAttr = align !== 'left' ? ` style="text-align: ${align}"` : ''
			html += `      <td${alignAttr}>${escapeHtml(cell)}</td>\n`
		})
		html += '    </tr>\n'
	})
	html += '  </tbody>\n'

	html += '</table>'
	return html
}

/**
 * Escape HTML special characters
 */
function escapeHtml(text: string): string {
	const map: Record<string, string> = {
		'&': '&amp;',
		'<': '&lt;',
		'>': '&gt;',
		'"': '&quot;',
		"'": '&#039;'
	}
	return text.replace(/[&<>"']/g, m => map[m])
}

/**
 * Copy HTML content to clipboard
 * Uses Clipboard API with text/html MIME type for Word compatibility
 */
export async function copyHtmlToClipboard(html: string): Promise<boolean> {
	if (!html) return false

	try {
		// Try modern Clipboard API with HTML support
		if (navigator.clipboard && window.isSecureContext) {
			const blob = new Blob([html], { type: 'text/html' })
			const item = new ClipboardItem({ 'text/html': blob })
			await navigator.clipboard.write([item])
			return true
		}

		// Fallback: copy as plain text (HTML tags will be visible)
		return fallbackCopyText(html)
	} catch (error) {
		console.error('Failed to copy HTML:', error)
		// Try fallback
		return fallbackCopyText(html)
	}
}

/**
 * Fallback copy function for non-secure contexts
 */
function fallbackCopyText(text: string): Promise<boolean> {
	return new Promise((resolve) => {
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
			const successful = document.execCommand('copy')
			resolve(successful)
		} catch (err) {
			console.error('Fallback copy failed:', err)
			resolve(false)
		} finally {
			document.body.removeChild(textArea)
		}
	})
}
