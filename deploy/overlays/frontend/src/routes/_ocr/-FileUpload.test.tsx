// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getTaskStatus, uploadTask } from '@/libs/api'
import { FileUpload } from './FileUpload'

vi.mock('@/libs/api', () => ({
	uploadTask: vi.fn(),
	getTaskStatus: vi.fn()
}))

vi.mock('sonner', () => ({
	toast: {
		error: vi.fn(),
		success: vi.fn()
	}
}))

const mockedUploadTask = vi.mocked(uploadTask)
const mockedGetTaskStatus = vi.mocked(getTaskStatus)

describe('FileUpload', () => {
	beforeEach(() => {
		mockedUploadTask.mockResolvedValue({
			task_id: 'task-1',
			document_id: 'doc-1',
			status: 'pending',
			created_at: '2026-05-07T00:00:00Z',
			priority: 2,
			processing_mode: 'formula'
		})
		mockedGetTaskStatus.mockResolvedValue({
			task_id: 'task-1',
			document_id: 'doc-1',
			status: 'completed',
			created_at: '2026-05-07T00:00:00Z',
			priority: 2,
			processing_mode: 'formula'
		})
		vi.spyOn(globalThis, 'setInterval').mockReturnValue(1 as unknown as ReturnType<typeof setInterval>)
		vi.spyOn(globalThis, 'clearInterval').mockImplementation(() => {})
	})

	afterEach(() => {
		cleanup()
		vi.restoreAllMocks()
	})

	it('submits formula processing mode when selected', async () => {
		const { container } = render(<FileUpload onFileUploaded={vi.fn()} />)

		fireEvent.click(screen.getByRole('button', { name: /公式识别/ }))
		const input = container.querySelector('input[type="file"]') as HTMLInputElement
		const file = new File(['image'], 'formula.png', { type: 'image/png' })
		fireEvent.change(input, { target: { files: [file] } })

		await waitFor(() => {
			expect(mockedUploadTask).toHaveBeenCalledWith(
				expect.objectContaining({
					file,
					processing_mode: 'formula'
				})
			)
		})
	})

	it('submits pasted images with the selected formula processing mode', async () => {
		render(<FileUpload onFileUploaded={vi.fn()} />)

		fireEvent.click(screen.getByRole('button', { name: /公式识别/ }))
		const file = new File(['image'], '', { type: 'image/png' })
		const pasteEvent = new Event('paste', {
			bubbles: true,
			cancelable: true
		}) as ClipboardEvent
		Object.defineProperty(pasteEvent, 'clipboardData', {
			value: {
				items: [
					{
						kind: 'file',
						type: 'image/png',
						getAsFile: () => file
					}
				]
			}
		})
		window.dispatchEvent(pasteEvent)

		await waitFor(() => {
			expect(mockedUploadTask).toHaveBeenCalledWith(
				expect.objectContaining({
					processing_mode: 'formula'
				})
			)
		})
	})
})
