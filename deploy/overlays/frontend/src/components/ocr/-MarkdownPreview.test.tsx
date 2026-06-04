// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useLinkStore } from '@/hooks/useLinkState'
import { useOcrStore } from '@/store/useOcrStore'
import { MarkdownPreview } from './MarkdownPreview'

vi.mock('@/hooks/useMdVirtualRendering', () => ({
	useMdVirtualRendering: () => ({
		visibleRange: [0, 20],
		itemHeights: {},
		totalHeight: 300,
		getItemOffset: vi.fn(() => 0),
		updateVisibleRange: vi.fn(),
		handleItemRenderSuccess: vi.fn()
	})
}))

vi.mock('sonner', () => ({
	toast: {
		success: vi.fn(),
		error: vi.fn(),
	}
}))

describe('MarkdownPreview table copy controls', () => {
	afterEach(() => {
		cleanup()
		useLinkStore.setState({ activeBlockId: null, source: null, eventId: 0, createdAt: 0, durationMs: 2200 })
		useOcrStore.setState({ hoveredBlockId: null, clickedBlockId: null, clickedPdfBlockId: null, blocks: [] })
	})

	it('shows the Word table copy action for HTML table blocks', () => {
		useOcrStore.setState({
			blocks: [{
				id: 1,
				content: '<table><tr><th>Item</th></tr><tr><td>Paper</td></tr></table>',
				bbox: null,
				pageIndex: 1,
				layoutType: 'table',
				width: 0,
				height: 0,
			}]
		})

		render(<MarkdownPreview />)
		const block = screen.getByText('Paper').closest('[data-block-id="1"]')
		expect(block).toBeTruthy()

		fireEvent.mouseEnter(block!)

		expect(screen.getByRole('button', { name: /^复制表格$/ })).toBeTruthy()
		expect(screen.queryByRole('button', { name: /^复制$/ })).toBeNull()
	})

	it('keeps the plain copy action for normal text blocks', () => {
		useOcrStore.setState({
			blocks: [{
				id: 2,
				content: 'normal OCR text',
				bbox: null,
				pageIndex: 1,
				layoutType: 'text',
				width: 0,
				height: 0,
			}]
		})

		render(<MarkdownPreview />)
		const block = screen.getByText('normal OCR text').closest('[data-block-id="2"]')
		expect(block).toBeTruthy()

		fireEvent.mouseEnter(block!)

		expect(screen.getByRole('button', { name: /^复制$/ })).toBeTruthy()
		expect(screen.queryByRole('button', { name: /^复制表格$/ })).toBeNull()
	})
})
