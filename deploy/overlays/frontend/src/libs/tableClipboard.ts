import { htmlToPlainText } from './tableHtml'
import type { CopyableTable } from './tableTypes'

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
