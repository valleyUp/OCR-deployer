// src/components/MarkdownPreview.tsx

'use client'

import { useRef, useMemo, useCallback, useState, useEffect } from 'react'
import { useOcrStore } from '@/store/useOcrStore'
import ReactMarkdown from 'react-markdown'
import rehypeRaw from 'rehype-raw'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'
import './markdown.css'
import rehypeMathInHtml from '@/libs/rehypeMathInHtml'
import { useMdVirtualRendering } from '@/hooks/useMdVirtualRendering'
import { CopyButton } from './CopyButton'
import { useLinkState, useLinkStore } from '@/hooks/useLinkState'
import { cn } from '@/libs/utils'

const VIRTUAL_CONFIG = {
	BUFFER_BLOCKS: 10,
	DEFAULT_BLOCK_HEIGHT: 150,
}

const katexOptions = {
	throwOnError: false,
	strict: false,
}

export function MarkdownPreview() {
	const { blocks, hoveredBlockId, clickedPdfBlockId, setHoveredBlockId, setClickedBlockId } = useOcrStore()
	const activeLinkId = useLinkStore(s => s.activeBlockId)
	const linkSource = useLinkStore(s => s.source)
	const linkEventId = useLinkStore(s => s.eventId)
	const { triggerLink } = useLinkState()
	const [showCopyButton, setShowCopyButton] = useState(false)
	const markdownRef = useRef<HTMLDivElement>(null)

	const {
		visibleRange,
		itemHeights: blockHeights,
		totalHeight,
		getItemOffset,
		updateVisibleRange,
		handleItemRenderSuccess: handleBlockRenderSuccess
	} = useMdVirtualRendering({
		containerRef: markdownRef,
		totalItems: blocks.length,
		config: {
			bufferSize: VIRTUAL_CONFIG.BUFFER_BLOCKS,
			defaultItemHeight: VIRTUAL_CONFIG.DEFAULT_BLOCK_HEIGHT,
			itemGap: 8,
			startIndex: 0
		}
	})

	const scrollToBlock = useCallback((blockId: string | number, smooth: boolean) => {
		const container = markdownRef.current
		if (!container || !getItemOffset) return

		const targetIndex = blocks.findIndex(block => String(block.id) === String(blockId))
		if (targetIndex === -1) return

		const itemOffset = getItemOffset(targetIndex)
		const itemHeight = blockHeights[targetIndex] || VIRTUAL_CONFIG.DEFAULT_BLOCK_HEIGHT
		const targetScrollTop = itemOffset - container.clientHeight / 2 + itemHeight / 2

		updateVisibleRange?.()
		requestAnimationFrame(() => {
			container.scrollTo({
				top: Math.max(0, targetScrollTop - 24),
				behavior: smooth ? 'smooth' : 'auto'
			})
		})
	}, [blocks, getItemOffset, blockHeights, updateVisibleRange])

	useEffect(() => {
		if (!activeLinkId || linkSource !== 'preview') return
		scrollToBlock(activeLinkId, true)
	}, [activeLinkId, linkSource, linkEventId, scrollToBlock])

	useEffect(() => {
		if (clickedPdfBlockId === null) return
		if (linkSource === 'preview' && activeLinkId === String(clickedPdfBlockId)) return
		scrollToBlock(clickedPdfBlockId, false)
	}, [clickedPdfBlockId, activeLinkId, linkSource, scrollToBlock])

	const handleImageError = useCallback((e: React.SyntheticEvent<HTMLImageElement, Event>) => {
		const target = e.target as HTMLImageElement
		if (target.dataset.fallback === 'true') return
		target.style.display = 'none'
	}, [])

	const markdownComponents = useMemo(
		() => ({
			img: ({ src, alt, ...props }: any) => (
				<img
					src={src}
					alt={alt || '图片'}
					className='max-w-full h-auto rounded-lg my-4 mx-auto block'
					style={{ width: 'auto', height: 'auto', maxWidth: '100%' }}
					{...props}
					onError={handleImageError}
				/>
			),
			div: ({ children, style, className, ...props }: any) => (
				<div style={style} className={className} {...props}>
					{children}
				</div>
			)
		}),
		[handleImageError]
	)

	if (!blocks || blocks.length === 0) {
		return (
			<div className='flex items-center justify-center h-full text-[var(--color-text-muted)]'>
				<p>No markdown content</p>
			</div>
		)
	}

	return (
		<div ref={markdownRef} className='h-full overflow-y-auto p-5 markdown-body'>
			<div className='max-w-3xl mx-auto relative' style={{ height: totalHeight }}>
				{blocks.map((block, index) => {
					if (block.id === null || block.id === undefined) return null

					const [startIndex, endIndex] = visibleRange
					const isInRange = index >= startIndex && index <= endIndex
					const isHovered = hoveredBlockId === block.id
					const isSelected = clickedPdfBlockId === block.id
					const isLinked = activeLinkId === String(block.id)
					const isActive = isHovered || isSelected || isLinked
					const isImage = block.isImage || false

					if (!isInRange) {
						const height = blockHeights[index] || VIRTUAL_CONFIG.DEFAULT_BLOCK_HEIGHT
						return (
							<div
								key={block.id}
								data-block-id={block.id}
								className={cn('content-block content-block-placeholder', isActive && 'is-active', isLinked && 'link-highlight')}
								style={{ minHeight: height }}
							/>
						)
					}

					return (
						<div
							key={block.id}
							ref={(el) => {
								if (el) setTimeout(() => handleBlockRenderSuccess(index, el), 0)
							}}
							data-block-id={block.id}
							className={cn(
								'content-block',
								isActive && 'is-active',
								isLinked && 'link-highlight',
								isImage && 'content-block-image'
							)}
							onMouseEnter={() => {
								setHoveredBlockId(block.id)
								setShowCopyButton(true)
							}}
							onMouseLeave={() => {
								setHoveredBlockId(null)
								setShowCopyButton(false)
							}}
							onClick={() => {
								if (isImage) return
								setClickedBlockId(block.id)
								triggerLink(String(block.id), 'result')
								setShowCopyButton(true)
							}}>
							<div className='prose prose-sm dark:prose-invert max-w-none'>
								<ReactMarkdown
									remarkPlugins={[remarkMath]}
									rehypePlugins={[rehypeRaw, rehypeMathInHtml, [rehypeKatex, katexOptions]]}
									components={markdownComponents}>
									{block.content}
								</ReactMarkdown>
							</div>
							{showCopyButton && isActive && !isImage && (
								<CopyButton content={block.content} />
							)}
						</div>
					)
				})}
			</div>
		</div>
	)
}
