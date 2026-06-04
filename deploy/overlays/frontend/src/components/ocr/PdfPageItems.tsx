import type React from 'react'
import { Page } from 'react-pdf'

interface PdfPageItemProps {
	pageNumber: number
	numPages: number
	height: number
	scale: number
	pageRefs: React.MutableRefObject<(HTMLDivElement | null)[]>
	renderPageOverlay?: (pageNumber: number) => React.ReactNode
	onPageClick?: (event: React.MouseEvent<HTMLDivElement>, pageNumber: number) => void
	onPageMouseMove?: (event: React.MouseEvent<HTMLDivElement>, pageNumber: number) => void
	onPageMouseLeave?: (event: React.MouseEvent<HTMLDivElement>, pageNumber: number) => void
	onPageRenderSuccess: (pageNumber: number, pageElement: HTMLDivElement) => void
}

export function PdfPageItem({
	pageNumber,
	numPages,
	height,
	scale,
	pageRefs,
	renderPageOverlay,
	onPageClick,
	onPageMouseMove,
	onPageMouseLeave,
	onPageRenderSuccess,
}: PdfPageItemProps) {
	return (
		<div
			key={`page_${pageNumber}`}
			ref={(el) => {
				pageRefs.current[pageNumber - 1] = el
				if (el) {
					setTimeout(() => onPageRenderSuccess(pageNumber, el), 0)
				}
			}}
			className="relative mb-6 mx-auto rounded-[16px] bg-white shadow-2xl shadow-black/5 ring-1 ring-[rgba(0,0,0,0.08)]"
			style={{ minHeight: numPages > 1 ? height * scale : 'auto', width: 'fit-content' }}
			data-pdf-page={pageNumber}
			data-pdf-visible
			onClick={onPageClick ? event => onPageClick(event, pageNumber) : undefined}
			onMouseMove={onPageMouseMove ? event => onPageMouseMove(event, pageNumber) : undefined}
			onMouseLeave={onPageMouseLeave ? event => onPageMouseLeave(event, pageNumber) : undefined}
		>
			<Page
				pageNumber={pageNumber}
				scale={scale}
				renderTextLayer={false}
				renderAnnotationLayer={false}
				onRenderError={(error) => console.error(`Page ${pageNumber} render error:`, error)}
			/>
			{renderPageOverlay ? renderPageOverlay(pageNumber) : null}
		</div>
	)
}

export function PdfPagePlaceholder({
	pageNumber,
	height,
	scale,
}: {
	pageNumber: number
	height: number
	scale: number
}) {
	return (
		<div
			key={`placeholder_${pageNumber}`}
			data-pdf-page={pageNumber}
			className="relative w-full mb-6"
			style={{ minHeight: height * scale }}
		>
		</div>
	)
}
