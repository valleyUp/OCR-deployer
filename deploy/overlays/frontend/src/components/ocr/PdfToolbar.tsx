import { ChevronLeft, ChevronRight, Eye, EyeOff, RotateCcw, ZoomIn, ZoomOut } from 'lucide-react'

interface PdfToolbarProps {
	controlsVisible: boolean
	currentPage: number
	inputValue: string
	numPages: number
	scale: number
	onInputChange: (value: string) => void
	onHide: () => void
	onShow: () => void
	prevPage: () => void
	nextPage: () => void
	zoomOut: () => void
	zoomIn: () => void
	resetZoom: () => void
}

export function PdfToolbar({
	controlsVisible,
	currentPage,
	inputValue,
	numPages,
	scale,
	onInputChange,
	onHide,
	onShow,
	prevPage,
	nextPage,
	zoomOut,
	zoomIn,
	resetZoom,
}: PdfToolbarProps) {
	if (!controlsVisible) {
		return (
			<button
				type="button"
				onClick={onShow}
				className="pointer-events-auto absolute bottom-6 left-1/2 z-20 flex size-10 -translate-x-1/2 items-center justify-center rounded-full border border-[var(--line-2)] bg-white/85 text-[#6F685D] shadow-lg backdrop-blur-xl transition-all hover:bg-white/95 hover:text-[#1D1D1F]"
				title="显示 PDF 控制条"
				aria-label="显示 PDF 控制条"
			>
				<Eye size={17} strokeWidth={1.5} />
			</button>
		)
	}

	return (
		<div className="pointer-events-auto absolute bottom-6 left-1/2 z-20 flex -translate-x-1/2 items-center gap-4 rounded-full border border-[var(--line-2)] bg-white/85 px-4 py-2 shadow-lg backdrop-blur-xl transition-all hover:bg-white/95">
			<div className="flex items-center gap-2">
				<button
					type="button"
					onClick={prevPage}
					disabled={currentPage <= 1}
					className="btn-icon size-8 cursor-pointer text-[#6F685D] hover:text-[#1D1D1F]"
					title="上一页"
					aria-label="上一页"
				>
					<ChevronLeft size={18} strokeWidth={1.5} />
				</button>
				<div className="flex items-center gap-1.5">
					<input
						type="number"
						min={1}
						max={numPages}
						value={inputValue}
						onChange={event => onInputChange(event.target.value)}
						onKeyDown={event => {
							if (event.key === 'Enter') {
								event.currentTarget.blur()
							}
						}}
						aria-label="PDF 页码"
						className="h-7 w-12 rounded-md border border-[var(--line-2)] bg-white text-center text-[13px] font-medium shadow-sm focus:border-[var(--a)] focus:outline-none focus:ring-1 focus:ring-[var(--a-glow)]"
					/>
					<span className="text-[13px] text-[var(--t-3)]">/ {numPages || '?'}</span>
				</div>
				<button
					type="button"
					onClick={nextPage}
					disabled={currentPage >= numPages}
					className="btn-icon size-8 cursor-pointer text-[#6F685D] hover:text-[#1D1D1F]"
					title="下一页"
					aria-label="下一页"
				>
					<ChevronRight size={18} strokeWidth={1.5} />
				</button>
			</div>

			<div className="h-5 w-[1px] bg-[var(--line-2)]"></div>

			<div className="flex items-center gap-2">
				<button
					type="button"
					onClick={zoomOut}
					className="btn-icon size-8 cursor-pointer text-[#6F685D] hover:text-[#1D1D1F]"
					title="缩小 PDF"
					aria-label="缩小 PDF"
				>
					<ZoomOut size={16} strokeWidth={1.5} />
				</button>
				<span className="w-12 text-center text-[13px] tabular-nums text-[var(--t-2)]">{Math.round(scale * 100)}%</span>
				<button
					type="button"
					onClick={zoomIn}
					className="btn-icon size-8 cursor-pointer text-[#6F685D] hover:text-[#1D1D1F]"
					title="放大 PDF"
					aria-label="放大 PDF"
				>
					<ZoomIn size={16} strokeWidth={1.5} />
				</button>
				<button
					type="button"
					onClick={resetZoom}
					className="btn-icon size-8 cursor-pointer text-[#6F685D] hover:text-[#1D1D1F]"
					title="重置 PDF 缩放"
					aria-label="重置 PDF 缩放"
				>
					<RotateCcw size={16} strokeWidth={1.5} />
				</button>
			</div>

			<div className="h-5 w-[1px] bg-[var(--line-2)]"></div>

			<button
				type="button"
				onClick={onHide}
				className="btn-icon size-8 cursor-pointer text-[#6F685D] hover:text-[#1D1D1F]"
				title="隐藏 PDF 控制条"
				aria-label="隐藏 PDF 控制条"
			>
				<EyeOff size={16} strokeWidth={1.5} />
			</button>
		</div>
	)
}
