// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { copyHtmlToClipboard, extractCopyableTable, hasCopyableTable } from './tableUtils'

class ClipboardItemMock {
	types: string[]
	items: Record<string, Blob>

	constructor(items: Record<string, Blob>) {
		this.items = items
		this.types = Object.keys(items)
	}
}

async function readBlob(blob: Blob): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader()
		reader.onload = () => resolve(String(reader.result))
		reader.onerror = () => reject(reader.error)
		reader.readAsText(blob)
	})
}

describe('tableUtils', () => {
	afterEach(() => {
		vi.restoreAllMocks()
		vi.unstubAllGlobals()
		Object.defineProperty(window, 'isSecureContext', { value: false, configurable: true })
		Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
	})

	it('extracts a Word-copyable table from markdown content', () => {
		const table = extractCopyableTable(`
Intro

| Name | Score |
| --- | ---: |
| Alice | 10 |
| Bob | 9 |
`)

		expect(table?.source).toBe('markdown')
		expect(table?.plainText).toBe('Name\tScore\nAlice\t10\nBob\t9')
		expect(table?.html).toContain('<table')
		expect(table?.html).toContain('<th')
		expect(table?.html).toContain('align="right"')
	})

	it('extracts a table from rendered HTML table content', () => {
		const table = extractCopyableTable(`
<p>before</p>
<table>
  <tr><th>Item</th><th align="right">Qty</th></tr>
  <tr><td>Paper</td><td>2</td></tr>
</table>
`)

		expect(table?.source).toBe('html')
		expect(table?.plainText).toBe('Item\tQty\nPaper\t2')
		expect(table?.html).toContain('<td')
		expect(table?.html).toContain('Paper')
	})

	it('wraps HTML row fragments returned by OCR as tables', () => {
		const table = extractCopyableTable(
			'<tr><th>药品</th><th>剂量</th></tr><tr><td>A</td><td>5mg</td></tr>',
			'table'
		)

		expect(hasCopyableTable('<td>A</td><td>B</td>', 'table')).toBe(true)
		expect(table?.plainText).toBe('药品\t剂量\nA\t5mg')
		expect(table?.html).toContain('<table')
	})

	it('writes both text/html and text/plain clipboard payloads', async () => {
		const write = vi.fn(async () => undefined)
		Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true })
		Object.defineProperty(navigator, 'clipboard', { value: { write }, configurable: true })
		vi.stubGlobal('ClipboardItem', ClipboardItemMock)

		const copied = await copyHtmlToClipboard('<table><tr><td>A</td></tr></table>', 'A')

		expect(copied).toBe(true)
		expect(write).toHaveBeenCalledTimes(1)
		const [[items]] = write.mock.calls as unknown as [[ClipboardItemMock[]]]
		const item = items[0]
		expect(item.types.sort()).toEqual(['text/html', 'text/plain'])
		await expect(readBlob(item.items['text/plain'])).resolves.toBe('A')
		await expect(readBlob(item.items['text/html'])).resolves.toContain('<table')
	})
})
