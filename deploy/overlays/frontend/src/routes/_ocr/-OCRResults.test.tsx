// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { act, fireEvent } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OCRResults } from './OCRResults'
import type { TaskResponse } from './FileUpload'
import { useLinkStore } from '@/hooks/useLinkState'
import { useOcrStore } from '@/store/useOcrStore'

vi.mock('@/components/ocr/MarkdownPreview', () => ({
	MarkdownPreview: () => <div>markdown panel</div>
}))

vi.mock('@/components/ocr/JsonPreview', () => ({
	JsonPreview: () => <div>json panel</div>
}))

vi.mock('@/components/ocr/FormulaPanel', () => ({
	FormulaPanel: ({ formulas }: { formulas: unknown[] }) => (
		<div>formula panel {formulas.length}</div>
	)
}))

vi.mock('sonner', () => ({
	toast: {
		success: vi.fn()
	}
}))

describe('OCRResults', () => {
	afterEach(() => {
		cleanup()
		useLinkStore.setState({ activeBlockId: null, source: null, eventId: 0, createdAt: 0, durationMs: 2200 })
		useOcrStore.setState({ hoveredBlockId: null, clickedBlockId: null, clickedPdfBlockId: null, blocks: [] })
	})

	function makeResult(processingMode: 'pipeline' | 'formula'): TaskResponse {
		return {
			fileId: 'file-1',
			status: 'completed',
			response: {
				task_id: 'task-1',
				document_id: 'doc-1',
				status: 'completed',
				created_at: '2026-05-07T00:00:00Z',
				priority: 2,
				processing_mode: processingMode,
				full_markdown: '$$x+y$$',
				layout: [{
					block_id: 7,
					block_content: '$$x+y$$',
					bbox: [10, 20, 110, 80],
					page_index: 1,
					layout_type: 'formula',
					formula_id: 'f-1',
					formula: { latex: 'x+y' }
				}],
				formulas: [{
					formula_id: 'f-1',
					task_id: 'task-1',
					block_id: 7,
					page_index: 1,
					bbox: [10, 20, 110, 80],
					layout_type: 'formula',
					latex: 'x+y'
				}]
			}
		}
	}

	it('auto-selects the formula tab for completed formula tasks', async () => {
		render(<OCRResults result={makeResult('formula')} fileName='formula.png' />)

		await waitFor(() => {
			expect(screen.getByRole('tab', { name: /Formulas/ }).getAttribute('aria-selected')).toBe('true')
		})
		expect(screen.getByText('formula panel 1')).toBeTruthy()
	})

	it('keeps preview formula links in Markdown for Docs tasks', async () => {
		render(<OCRResults result={makeResult('pipeline')} fileName='paper.pdf' />)

		fireEvent.click(screen.getByRole('tab', { name: /Formulas/ }))
		expect(screen.getByRole('tab', { name: /Formulas/ }).getAttribute('aria-selected')).toBe('true')

		act(() => {
			useLinkStore.getState().activate('7', 'preview')
		})

		await waitFor(() => {
			expect(screen.getByRole('tab', { name: /Markdown/ }).getAttribute('aria-selected')).toBe('true')
		})
	})

	it('routes preview formula links to Formulas for Formula tasks', async () => {
		render(<OCRResults result={makeResult('formula')} fileName='formula.png' />)

		fireEvent.click(screen.getByRole('tab', { name: /Markdown/ }))
		expect(screen.getByRole('tab', { name: /Markdown/ }).getAttribute('aria-selected')).toBe('true')

		act(() => {
			useLinkStore.getState().activate('7', 'preview')
		})

		await waitFor(() => {
			expect(screen.getByRole('tab', { name: /Formulas/ }).getAttribute('aria-selected')).toBe('true')
		})
	})

	it('increments link events for repeated clicks on the same block', () => {
		act(() => {
			useLinkStore.getState().activate('7', 'preview')
		})
		const firstEventId = useLinkStore.getState().eventId

		act(() => {
			useLinkStore.getState().activate('7', 'preview')
		})

		expect(useLinkStore.getState().eventId).toBe(firstEventId + 1)
	})
})
