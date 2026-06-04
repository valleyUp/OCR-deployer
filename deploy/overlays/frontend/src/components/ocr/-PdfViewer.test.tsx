// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import PdfViewer from './PdfViewer'

type MockDocumentProps = {
	children?: ReactNode
	onLoadSuccess?: (result: { numPages: number }) => void
}

type MockPageProps = {
	pageNumber: number
}

vi.mock('react-pdf', async () => {
	const React = await vi.importActual<typeof import('react')>('react')
	return {
		pdfjs: { GlobalWorkerOptions: {} },
		Document: ({ children, onLoadSuccess }: MockDocumentProps) => {
			React.useEffect(() => {
				onLoadSuccess?.({ numPages: 2 })
			}, [])
			return React.createElement('div', null, children)
		},
		Page: ({ pageNumber }: MockPageProps) => React.createElement('canvas', {
			className: 'react-pdf__Page__canvas',
			'data-page-number': pageNumber,
		})
	}
})

vi.mock('@/hooks/usePdfNavigation', () => ({
	usePdfNavigation: () => ({
		currentPage: 1,
		inputValue: '1',
		setInputValue: vi.fn(),
		setCurrentPage: vi.fn(),
		prevPage: vi.fn(),
		nextPage: vi.fn(),
		isProgrammaticScrollRef: { current: false },
		lastProgrammaticPageRef: { current: 0 },
	})
}))

vi.mock('@/hooks/usePdfZoom', () => ({
	usePdfZoom: () => ({
		scale: 1,
		zoomIn: vi.fn(),
		zoomOut: vi.fn(),
		resetZoom: vi.fn(),
		setAutoScale: vi.fn(),
		isInitialScaleSetRef: { current: true },
	})
}))

describe('PdfViewer controls visibility', () => {
	beforeEach(() => {
		vi.stubGlobal('ResizeObserver', class {
			observe() {}
			disconnect() {}
		})
	})

	afterEach(() => {
		cleanup()
		vi.unstubAllGlobals()
	})

	it('hides and restores the rounded PDF page and zoom toolbar', async () => {
		render(<PdfViewer file='paper.pdf' />)

		const hideButton = await screen.findByLabelText('隐藏 PDF 控制条')
		expect(screen.getByText('/ 2')).toBeTruthy()

		fireEvent.click(hideButton)

		expect(screen.queryByLabelText('隐藏 PDF 控制条')).toBeNull()
		const showButton = screen.getByLabelText('显示 PDF 控制条')
		expect(showButton).toBeTruthy()

		fireEvent.click(showButton)

		expect(screen.getByLabelText('隐藏 PDF 控制条')).toBeTruthy()
		expect(screen.queryByLabelText('显示 PDF 控制条')).toBeNull()
	})

	it('labels PDF navigation and zoom controls for assistive technology', async () => {
		render(<PdfViewer file='paper.pdf' />)

		expect(await screen.findByLabelText('上一页')).toBeTruthy()
		expect(screen.getByLabelText('下一页')).toBeTruthy()
		expect(screen.getByLabelText('缩小 PDF')).toBeTruthy()
		expect(screen.getByLabelText('放大 PDF')).toBeTruthy()
		expect(screen.getByLabelText('重置 PDF 缩放')).toBeTruthy()
	})
})
