import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'
import type { Block } from '../store/useOcrStore'

export function usePdfScrollToBlock(
	clickedBlockId: number | null,
	clickedBlock: Block | null,
	viewerRef: RefObject<HTMLDivElement>,
	pdfOriginalWidth: number,
	pdfOriginalHeight: number,
	resultStatus: string | undefined
) {
	const isScrollingRef = useRef(false)

	useEffect(() => {
		if (resultStatus !== 'completed' || !pdfOriginalWidth || !pdfOriginalHeight) return
		if (clickedBlockId === null || !clickedBlock || !viewerRef.current || !clickedBlock.bbox) return

		isScrollingRef.current = true
		const pageNumber = clickedBlock.pageIndex ?? 1

		const performPreciseScroll = (
			scrollContainer: HTMLElement,
			pageWrapper: HTMLElement,
			canvas: HTMLCanvasElement
		) => {
			const pageRect = pageWrapper.getBoundingClientRect()
			const containerRect = scrollContainer.getBoundingClientRect()
			const pageOffsetY = pageRect.top - containerRect.top + scrollContainer.scrollTop
			const canvasRect = canvas.getBoundingClientRect()
			const scaleY = canvasRect.height / pdfOriginalHeight
			const yWithinPage = clickedBlock.bbox?.[1] ?? 0
			const blockHeight = Math.max(24, clickedBlock.height * scaleY)
			const targetY = pageOffsetY + yWithinPage * scaleY - scrollContainer.clientHeight / 2 + blockHeight / 2

			scrollContainer.scrollTo({
				top: Math.max(0, targetY),
				behavior: 'smooth'
			})

			setTimeout(() => {
				isScrollingRef.current = false
			}, 220)
		}

		const scrollToBlock = () => {
			const root = viewerRef.current
			const scrollContainer = root?.querySelector('.pdf-scroll-container') as HTMLElement | null
			if (!root || !scrollContainer) {
				isScrollingRef.current = false
				return
			}

			let pageWrapper = root.querySelector(`[data-pdf-page="${pageNumber}"]`) as HTMLElement | null
			let canvas = pageWrapper?.querySelector('.react-pdf__Page__canvas') as HTMLCanvasElement | null

			if (pageWrapper && canvas) {
				performPreciseScroll(scrollContainer, pageWrapper, canvas)
				return
			}

			let currentScale = 1
			const visibleRenderedPage = root.querySelector('[data-pdf-visible]') as HTMLElement | null
			const visibleCanvas = visibleRenderedPage?.querySelector('.react-pdf__Page__canvas') as HTMLCanvasElement | null
			if (visibleCanvas && visibleRenderedPage && pdfOriginalHeight > 0) {
				currentScale = visibleRenderedPage.getBoundingClientRect().height / pdfOriginalHeight
			}

			let pageOffset = 20
			for (let i = 1; i < pageNumber; i++) pageOffset += pdfOriginalHeight * currentScale + 20
			scrollContainer.scrollTo({ top: pageOffset, behavior: 'auto' })

			let retryCount = 0
			const checkAndScroll = () => {
				retryCount += 1
				if (retryCount > 40) {
					isScrollingRef.current = false
					return
				}

				pageWrapper = root.querySelector(`[data-pdf-page="${pageNumber}"]`) as HTMLElement | null
				canvas = pageWrapper?.querySelector('.react-pdf__Page__canvas') as HTMLCanvasElement | null
				if (!pageWrapper || !canvas) {
					requestAnimationFrame(checkAndScroll)
					return
				}
				performPreciseScroll(scrollContainer, pageWrapper, canvas)
			}

			requestAnimationFrame(checkAndScroll)
		}

		const timer = setTimeout(scrollToBlock, 80)
		return () => {
			clearTimeout(timer)
			isScrollingRef.current = false
		}
	}, [clickedBlockId, clickedBlock, viewerRef, pdfOriginalHeight, pdfOriginalWidth, resultStatus])
}
