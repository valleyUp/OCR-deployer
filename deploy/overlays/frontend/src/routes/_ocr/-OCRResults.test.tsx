// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OCRResults } from './OCRResults'
import type { TaskResponse } from './FileUpload'

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
	})

	it('auto-selects the formula tab for completed formula tasks even without formulas', async () => {
		const result: TaskResponse = {
			fileId: 'file-1',
			status: 'completed',
			response: {
				task_id: 'task-1',
				document_id: 'doc-1',
				status: 'completed',
				created_at: '2026-05-07T00:00:00Z',
				priority: 2,
				processing_mode: 'formula',
				full_markdown: '',
				layout: [],
				formulas: []
			}
		}

		render(<OCRResults result={result} fileName='formula.png' />)

		await waitFor(() => {
			expect(screen.getByRole('tab', { name: /公式/ }).getAttribute('data-state')).toBe('active')
		})
		expect(screen.getByText('formula panel 0')).toBeTruthy()
	})
})
