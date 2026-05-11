import {
	useEffect,
	useMemo,
	useRef,
	useState,
	type RefObject
} from 'react'
import {
	FileImage,
	FileText,
	LocateFixed,
	Maximize2,
	Minus,
	Plus,
	RotateCw
} from 'lucide-react'
import type { TaskResponse, UploadedFile } from './FileUpload'
import { useOcrStore } from '../../store/useOcrStore'
import PdfViewer from '@/components/ocr/PdfViewer'
import { usePdfPageMetrics } from '@/hooks/usePdfPageMetrics'
import { useFileBlockInteraction } from '@/hooks/useFileBlockInteraction'
import { usePdfScrollToBlock } from '@/hooks/usePdfScrollToBlock'
import { HighlightOverlay } from '@/components/ocr/HighlightOverlay'
import { Button } from '@/components/ui/button'
import { cn } from '@/libs/utils'
import { formatFileSize } from '@/libs/format'

interface FilePreviewProps {
	file: UploadedFile | null
	result: TaskResponse | null
}

const IMAGE_ZOOM_MIN = 0.25
const IMAGE_ZOOM_MAX = 4
const IMAGE_ZOOM_STEP = 0.25

export function FilePreview({ file, result }: FilePreviewProps) {
	const [pdfUrl, setPdfUrl] = useState<string | null>(file?.file?.name || null)
	const viewerRef = useRef<HTMLDivElement>(null)
	const imageRef = useRef<HTMLImageElement>(null)
	const hoveredBlockId = useOcrStore(s => s.hoveredBlockId)
	const clickedBlockId = useOcrStore(s => s.clickedBlockId)
	const setHoveredBlockId = useOcrStore(s => s.setHoveredBlockId)
	const setClickedPdfBlockId = useOcrStore(s => s.setClickedPdfBlockId)
	const blocks = useOcrStore(s => s.blocks)

	const [showCopyButton, setShowCopyButton] = useState(false)
	const [imageZoom, setImageZoom] = useState(1)
	const [imageRotation, setImageRotation] = useState(0)

	const lowerFileName = file?.name.toLowerCase() ?? ''
	const isPdfFile = Boolean(
		file && (file.type === 'application/pdf' || lowerFileName.endsWith('.pdf'))
	)
	const isImageFile = Boolean(
		file &&
			(file.type.startsWith('image/') ||
				/\.(png|jpe?g|webp|bmp|gif)$/i.test(lowerFileName))
	)

	const pdfOriginalWidth = result?.response?.metadata?.width ?? 1654
	const pdfOriginalHeight = result?.response?.metadata?.height ?? 2339

	const isValid = useMemo(() => {
		return (
			!isNaN(pdfOriginalWidth) &&
			!isNaN(pdfOriginalHeight) &&
			result?.status === 'completed'
		)
	}, [pdfOriginalWidth, pdfOriginalHeight, result?.status])

	const hoveredBlock = hoveredBlockId
		? blocks.find(b => b.id === hoveredBlockId)
		: null
	const clickedBlock = clickedBlockId
		? blocks.find(b => b.id === clickedBlockId)
		: null
	const activeBlock = clickedBlock || hoveredBlock || null
	const activeState: 'hover' | 'click' = clickedBlock ? 'click' : 'hover'

	const [imageScale, setImageScale] = useState({
		x: 1,
		y: 1,
		offsetX: 0,
		offsetY: 0
	})

	const processingMode =
		result?.response?.processing_mode ||
		result?.response?.metadata?.processing_mode ||
		file?.processingMode

	useEffect(() => {
		if (!imageRef.current || isPdfFile) return

		const updateImageScale = () => {
			const img = imageRef.current
			if (!img) return
			const imgRect = img.getBoundingClientRect()
			const containerRect = img.parentElement?.getBoundingClientRect()
			if (!containerRect) return
			const scaleX = imgRect.width / img.naturalWidth
			const scaleY = imgRect.height / img.naturalHeight
			const offsetX = imgRect.left - containerRect.left
			const offsetY = imgRect.top - containerRect.top
			setImageScale({ x: scaleX, y: scaleY, offsetX, offsetY })
		}

		const img = imageRef.current
		if (img.complete) updateImageScale()
		else img.addEventListener('load', updateImageScale)

		window.addEventListener('resize', updateImageScale)
		return () => {
			img.removeEventListener('load', updateImageScale)
			window.removeEventListener('resize', updateImageScale)
		}
	}, [pdfUrl, isPdfFile, imageZoom, imageRotation])

	const pdfPageMetrics = usePdfPageMetrics(
		viewerRef as RefObject<HTMLDivElement>,
		pdfUrl,
		isPdfFile ? 'application/pdf' : file?.type,
		isValid,
		activeBlock,
		pdfOriginalWidth,
		pdfOriginalHeight
	)

	const {
		handlePdfClick,
		handlePdfMouseMove,
		handlePdfMouseLeave,
		handleImageClick,
		handleImageMouseMove,
		handleImageMouseLeave
	} = useFileBlockInteraction({
		blocks,
		resultStatus: result?.status,
		setHoveredBlockId,
		setClickedBlockId: setClickedPdfBlockId,
		setShowCopyButton
	})

	usePdfScrollToBlock(
		clickedBlockId,
		clickedBlock ?? null,
		viewerRef as RefObject<HTMLDivElement>,
		pdfOriginalWidth,
		pdfOriginalHeight,
		result?.status
	)

	useEffect(() => {
		if (!hoveredBlockId && !clickedBlockId) setShowCopyButton(false)
	}, [hoveredBlockId, clickedBlockId])

	useEffect(() => {
		if (file && (isPdfFile || isImageFile)) {
			const url = URL.createObjectURL(file.file)
			setPdfUrl(url)
			setImageZoom(1)
			setImageRotation(0)
			return () => URL.revokeObjectURL(url)
		}
		setPdfUrl(null)
	}, [file, isPdfFile, isImageFile])

	const renderPdfPageOverlay = (pageNumber: number) => {
		if (!activeBlock || !activeBlock.bbox) return null
		if (activeBlock.pageIndex !== pageNumber) return null
		const metrics = pdfPageMetrics[pageNumber]
		if (!metrics) return null
		const scaleX = metrics.width / pdfOriginalWidth
		const scaleY = metrics.height / pdfOriginalHeight
		return (
			<HighlightOverlay
				block={activeBlock}
				showCopyButton={showCopyButton}
				state={activeState}
				style={{
					left: metrics.offsetX + activeBlock.bbox[0] * scaleX,
					top: metrics.offsetY + activeBlock.bbox[1] * scaleY,
					width: activeBlock.width * scaleX,
					height: activeBlock.height * scaleY
				}}
			/>
		)
	}

	if (!file) {
		return (
			<div className='workspace'>
				<header className='workspace-head'>
					<div className='crumbs'>
						<span>task</span>
						<span>/</span>
						<strong>—</strong>
					</div>
				</header>
				<div className='preview-scroll sb-accent'>
					<div className='preview-stage'>
						<article className='page-canvas'>
							<h2 className='doc-title'>Drop a file to begin</h2>
							<div className='doc-line wide' />
							<div className='doc-line mid' />
							<div className='doc-line short' />
							<div className='formula-block' data-label='eq 01'>
								E = mc² + ∫₀ᵀ λ(t)dt
							</div>
							<div className='doc-line wide' />
							<div className='doc-line wide' />
							<div className='formula-block' data-label='eq 02'>
								∇ · (κ∇u) + f = 0
							</div>
							<div className='doc-line mid' />
						</article>
					</div>
				</div>
			</div>
		)
	}

	const imageToolbar = isImageFile ? (
		<div className='pointer-events-auto absolute right-4 top-4 z-20 flex items-center gap-1 rounded-full border border-[rgba(38,35,29,0.10)] bg-white/85 px-1 py-1 shadow-sm backdrop-blur-xl'>
			<Button
				variant='ghost'
				size='icon-sm'
				className='btn-icon size-8'
				aria-label='缩小'
				disabled={imageZoom <= IMAGE_ZOOM_MIN + 1e-6}
				onClick={() =>
					setImageZoom(z =>
						Math.max(IMAGE_ZOOM_MIN, Math.round((z - IMAGE_ZOOM_STEP) * 100) / 100)
					)
				}>
				<Minus className='size-4' />
			</Button>
			<span className='min-w-[3.25rem] text-center text-[11px] tabular-nums text-[#6F685D]'>
				{Math.round(imageZoom * 100)}%
			</span>
			<Button
				variant='ghost'
				size='icon-sm'
				className='btn-icon size-8'
				aria-label='放大'
				disabled={imageZoom >= IMAGE_ZOOM_MAX - 1e-6}
				onClick={() =>
					setImageZoom(z =>
						Math.min(IMAGE_ZOOM_MAX, Math.round((z + IMAGE_ZOOM_STEP) * 100) / 100)
					)
				}>
				<Plus className='size-4' />
			</Button>
			<span className='mx-1 h-4 w-px bg-[rgba(38,35,29,0.10)]' aria-hidden='true' />
			<Button
				variant='ghost'
				size='icon-sm'
				className='btn-icon size-8'
				aria-label='适应窗口'
				onClick={() => {
					setImageZoom(1)
					setImageRotation(0)
				}}>
				<Maximize2 className='size-4' />
			</Button>
			<Button
				variant='ghost'
				size='icon-sm'
				className='btn-icon size-8'
				aria-label='旋转 90°'
				onClick={() => setImageRotation(r => (r + 90) % 360)}>
				<RotateCw className='size-4' />
			</Button>
		</div>
	) : null

	return (
		<div className='workspace'>
			<header className='workspace-head'>
				<div className='crumbs'>
					<span>task</span>
					<span>/</span>
					<strong>{file.name}</strong>
				</div>
				<div className='chips' style={{ marginTop: 0 }}>
					<span className='mono-chip'>processing_mode={processingMode || 'pipeline'}</span>
					<span className='mono-chip'>layout_device=cuda:0</span>
				</div>
			</header>

			<div className='preview-scroll sb-accent'>
				<div className='preview-stage'>
					{/* Toolbar row */}
					<div className='flex items-center justify-between gap-4'>
						<div className='flex min-w-0 items-center gap-3'>
							<span
								className={cn(
									'icon-wrap shrink-0',
									isPdfFile ? 'icon-danger' : 'icon-primary'
								)}>
								{isPdfFile ? (
									<FileText className='size-[18px]' />
								) : (
									<FileImage className='size-[18px]' />
								)}
							</span>
							<div className='min-w-0'>
								<p className='job-name'>{file.name}</p>
								<p className='job-meta'>
									{formatFileSize(file.size)} · {isPdfFile ? 'PDF' : 'Image'}
								</p>
							</div>
						</div>
						<div className='flex shrink-0 items-center gap-2'>
							<span className='status-pill status-info'>
								<LocateFixed className='size-3' />
								{activeBlock?.layoutType || 'preview'}
							</span>
							<span
								className={cn(
									'status-pill',
									result?.status === 'completed'
										? 'status-ok'
										: result?.status === 'failed'
											? 'status-warn'
											: 'status-info'
								)}>
								{result?.status === 'completed'
									? 'done'
										: result?.status === 'failed'
											? 'failed'
											: result?.status === 'processing'
												? 'processing'
												: 'idle'}
							</span>
						</div>
					</div>

					{/* Preview content */}
						<div className='relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-[var(--line-2)] bg-white' ref={viewerRef}>
						{imageToolbar}
						{isPdfFile ? (
							<PdfViewer
								file={file.file}
								className='h-full'
								renderPageOverlay={renderPdfPageOverlay}
								onPageClick={(e, pageNumber) =>
									handlePdfClick(e, pageNumber, pdfOriginalWidth, pdfOriginalHeight)
								}
								onPageMouseMove={(e, pageNumber) =>
									handlePdfMouseMove(e, pageNumber, pdfOriginalWidth, pdfOriginalHeight)
								}
								onPageMouseLeave={handlePdfMouseLeave}
							/>
						) : isImageFile && pdfUrl ? (
							<div
								className={cn(
									'scrollbar-thin relative flex h-full cursor-pointer items-center justify-center overflow-auto bg-[#F7F5EE] p-6',
									imageZoom > 1 && 'cursor-grab'
								)}
								onClick={handleImageClick}
								onMouseMove={handleImageMouseMove}
								onMouseLeave={handleImageMouseLeave}>
								<img
									ref={imageRef}
									src={pdfUrl}
									alt={file.name}
									className='max-h-full max-w-full rounded-lg object-contain shadow-md ring-1 ring-black/5 transition-transform duration-200 ease-out'
									style={{
										transform: `scale(${imageZoom}) rotate(${imageRotation}deg)`,
										transformOrigin: 'center center'
									}}
								/>
								{activeBlock && activeBlock.bbox && imageRotation === 0 && imageZoom === 1 && (
									<HighlightOverlay
										block={activeBlock}
										showCopyButton={showCopyButton}
										state={activeState}
										style={{
											left: imageScale.offsetX + activeBlock.bbox[0] * imageScale.x,
											top: imageScale.offsetY + activeBlock.bbox[1] * imageScale.y,
											width: activeBlock.width * imageScale.x,
											height: activeBlock.height * imageScale.y
										}}
										copyButtonClassName='right-6'
									/>
								)}
							</div>
						) : (
							<div className='flex h-full items-center justify-center bg-[#F7F5EE] text-sm text-[#9A9286]'>
								<p>不支持的文件格式</p>
							</div>
						)}
					</div>
				</div>
			</div>
		</div>
	)
}
