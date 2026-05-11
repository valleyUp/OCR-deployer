import { useEffect, useMemo, useRef, useState } from 'react'
import type { TaskResponse } from './FileUpload'
import { MarkdownPreview } from '@/components/ocr/MarkdownPreview'
import { useOcrStore } from '../../store/useOcrStore'
import {
	DownloadIcon,
	FileTextIcon,
	Layers,
	Sigma,
	Timer,
	Workflow
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from 'sonner'
import { JsonPreview } from '@/components/ocr/JsonPreview'
import { FormulaPanel } from '@/components/ocr/FormulaPanel'
import type { FormulaItem } from '@/libs/api'
import { cn } from '@/libs/utils'

interface OCRResultsProps {
	result: TaskResponse | null
	fileName?: string
}

type ResultTab = 'markdown' | 'json' | 'formulas'

const isFormulaLayout = (layoutType?: string) => {
	const label = String(layoutType || '').toLowerCase()
	return label.includes('formula') || label.includes('equation')
}

function MarkdownSkeleton() {
	return (
		<div className='space-y-4 p-6'>
			<Skeleton className='h-7 w-[45%] rounded-full' />
			<div className='space-y-2'>
				<Skeleton className='h-3.5 w-[92%] rounded-full' />
				<Skeleton className='h-3.5 w-[88%] rounded-full' />
				<Skeleton className='h-3.5 w-[70%] rounded-full' />
			</div>
			<Skeleton className='h-40 w-full rounded-xl' />
			<div className='space-y-2'>
				<Skeleton className='h-3.5 w-[84%] rounded-full' />
				<Skeleton className='h-3.5 w-[94%] rounded-full' />
				<Skeleton className='h-3.5 w-[60%] rounded-full' />
			</div>
			<Skeleton className='h-24 w-full rounded-xl' />
		</div>
	)
}

export function OCRResults({ result, fileName }: OCRResultsProps) {
	const setBlocks = useOcrStore(s => s.setBlocks)

	const [activeTab, setActiveTab] = useState<ResultTab>('markdown')
	const autoSwitchedRef = useRef(false)
	const autoSwitchTaskRef = useRef<string | number | null>(null)

	const layout = useMemo(() => result?.response?.layout || [], [result?.response?.layout])
	const images = useMemo(() => result?.response?.images || {}, [result?.response?.images])

	const pageHeight = result?.response?.metadata?.height ?? 2339

	const formulas = useMemo<FormulaItem[]>(() => {
		const responseFormulas = result?.response?.formulas
		if (responseFormulas?.length) return responseFormulas
		return layout
			.filter((b: any) => b.formula?.latex || isFormulaLayout(b.layout_type))
			.map((b: any, index: number) => ({
				formula_id:
					b.formula_id || `formula-p${b.page_index ?? 1}-b${b.block_id ?? index + 1}`,
				task_id: result?.response?.task_id,
				block_id: b.block_id,
				page_index: b.page_index ?? 1,
				bbox: b.bbox ?? null,
				layout_type: b.layout_type,
				latex:
					b.formula?.latex ||
					String(b.block_content || '')
						.replace(/^\$\$|\\\[|\\\(|\$\$$|\\\]|\\\)$/g, '')
						.trim(),
				formula: b.formula
			}))
	}, [layout, result?.response?.formulas, result?.response?.task_id])

	const blocks = useMemo(() => {
		if (result?.status !== 'completed') return []
		return layout
			.filter((b: any) => b.block_content && b.block_content.trim() !== '')
			.map((b: any, index: number) => {
				const blockContent = b.block_content.trim()
				let bbox: [number, number, number, number] | null = null
				let width = 0
				let height = 0
				if (b.bbox) {
					const [x1, y1, x2, y2] = b.bbox as [number, number, number, number]
					width = x2 - x1
					height = y2 - y1
					bbox = [x1, y1, x2, y2]
				}
				return {
					id: b.block_id ?? index + Math.random() * 1000000,
					content: blockContent,
					bbox,
					pageIndex: b.page_index ?? 1,
					isImage: blockContent.startsWith('!['),
					layoutType: b.layout_type,
					formulaId: b.formula_id,
					latex: b.formula?.latex,
					width,
					height
				}
			})
	}, [layout, images, pageHeight, result?.status])

	useEffect(() => {
		if (result?.status === 'completed') setBlocks(blocks)
	}, [blocks, result?.status, setBlocks])

	useEffect(() => {
		const taskId = result?.response?.task_id
		if (taskId && autoSwitchTaskRef.current !== taskId) {
			autoSwitchTaskRef.current = taskId ?? null
			autoSwitchedRef.current = false
		}
		const processingMode =
			result?.response?.processing_mode ||
			result?.response?.metadata?.processing_mode
		if (
			!autoSwitchedRef.current &&
			result?.status === 'completed' &&
			processingMode === 'formula'
		) {
			setActiveTab('formulas')
			autoSwitchedRef.current = true
		} else if (
			!autoSwitchedRef.current &&
			result?.status === 'completed' &&
			processingMode &&
			processingMode !== 'formula' &&
			activeTab === 'formulas'
		) {
			setActiveTab('markdown')
			autoSwitchedRef.current = true
		}
	}, [
		activeTab,
		result?.status,
		result?.response?.task_id,
		result?.response?.processing_mode,
		result?.response?.metadata?.processing_mode
	])

	const clickedPdfBlockId = useOcrStore(s => s.clickedPdfBlockId)
	useEffect(() => {
		if (clickedPdfBlockId === null) return
		const block = blocks.find(b => b.id === clickedPdfBlockId)
		if (!block) return
		if (block.formulaId || block.layoutType?.includes('formula') || block.latex) {
			setActiveTab('formulas')
		}
	}, [clickedPdfBlockId, blocks])

	const handleDownload = () => {
		if (!result?.response?.full_markdown) return
		const blob = new Blob([result.response.full_markdown], {
			type: 'text/markdown'
		})
		const url = URL.createObjectURL(blob)
		const a = document.createElement('a')
		a.href = url
		a.download = `${fileName || 'result'}.md`
		a.click()
		URL.revokeObjectURL(url)
		toast.success('下载已开始')
	}

	const response = result?.response
	const status = result?.status
	const errorMessage = result?.error_message

	const metadata = response?.metadata
	const totalPages = metadata?.total_pages ?? layout.reduce((max: number, b: any) => Math.max(max, b.page_index ?? 1), 0)
	const executionSeconds = response?.execution_time ?? response?.result?.execution_time
	const processingMode =
		response?.processing_mode || metadata?.processing_mode || 'pipeline'
	const modeLabel = processingMode === 'formula' ? '公式识别' : '文档 OCR'

	const metaBadges =
		status === 'completed'
			? [
					{
						key: 'mode',
						icon: Workflow,
						label: modeLabel
					},
					totalPages
						? {
								key: 'pages',
								icon: Layers,
								label: `${totalPages} 页`
							}
						: null,
					formulas.length
						? {
								key: 'formulas',
								icon: Sigma,
								label: `${formulas.length} 公式`
							}
						: null,
					typeof executionSeconds === 'number'
						? {
								key: 'time',
								icon: Timer,
								label: `${executionSeconds.toFixed(1)} s`
							}
						: null
				].filter((item): item is { key: string; icon: any; label: string } => Boolean(item))
			: []

	return (
		<div className='flex h-full flex-col'>
			{/* Header */}
			<header className='result-head'>
				<div className='result-title'>
					<h1>Recognition Result</h1>
					<p>
						{processingMode === 'formula'
							? 'equation blocks only · formula tab active'
							: 'full layout · markdown tab active'}
					</p>
				</div>
				<button className='btn-outline' onClick={handleDownload}>
					<DownloadIcon className='size-4' />
					Export ZIP
				</button>
			</header>

			{/* Tab switcher — sliding pill */}
			<div className='tab-shell'>
				<div className='tab-list' role='tablist' data-active={activeTab}>
					<span className='result-thumb' aria-hidden='true' />
					<button
						className='result-tab interactive'
						role='tab'
						aria-selected={activeTab === 'markdown'}
						onClick={() => setActiveTab('markdown')}>
						Markdown
					</button>
					<button
						className='result-tab interactive'
						role='tab'
						aria-selected={activeTab === 'json'}
						onClick={() => setActiveTab('json')}>
						JSON
					</button>
					<button
						className='result-tab interactive'
						role='tab'
						aria-selected={activeTab === 'formulas'}
						onClick={() => setActiveTab('formulas')}>
						公式
					</button>
				</div>
			</div>

			{/* Meta badges */}
			{metaBadges.length > 0 && (
				<div className='flex flex-wrap items-center gap-1.5 border-b border-[rgba(38,35,29,0.06)] bg-[rgba(255,255,255,0.6)] px-4 py-2'>
					{metaBadges.map(item => {
						const Icon = item.icon
						return (
							<Badge
								key={item.key}
								variant='outline'
								className='pill h-6 gap-1 px-2 text-[11px] font-medium'>
								<Icon className='size-3' />
								{item.label}
							</Badge>
						)
					})}
				</div>
			)}

			{/* Content panels */}
			<div className='panel-scroll sb-line'>
				{/* Markdown panel */}
				<section className={cn('tab-panel', activeTab === 'markdown' && 'active')}>
					{status === 'completed' && (
						<div className='summary-grid'>
							<div className='metric'>
								<strong>{layout.length}</strong>
								<span>blocks</span>
							</div>
							<div className='metric'>
								<strong>{String(totalPages).padStart(2, '0')}</strong>
								<span>page</span>
							</div>
							<div className='metric'>
								<strong>{processingMode === 'formula' ? '100%' : String(formulas.length)}</strong>
								<span>formula</span>
							</div>
						</div>
					)}
					{status === 'pending' || status === 'processing' ? (
						<div className='scrollbar-thin overflow-auto'>
							<MarkdownSkeleton />
						</div>
					) : blocks.length > 0 && status === 'completed' ? (
						<div className='card markdown-card'>
							<MarkdownPreview />
						</div>
					) : status === 'completed' ? (
						<div className='flex items-center justify-center py-20'>
							<div className='rounded-xl border border-dashed border-[rgba(38,35,29,0.16)] bg-white/50 p-5 text-center text-sm text-[#9A9286]'>
								<p>暂无 Markdown 内容</p>
							</div>
						</div>
					) : status === 'failed' ? (
						<div className='flex items-center justify-center py-20'>
							<div className='max-w-xs rounded-xl border border-red-200 bg-red-50/90 p-4 text-center text-sm text-[#B91C1C]'>
								<p className='font-medium'>解析失败</p>
								{errorMessage && (
									<p className='mt-1 break-all text-[12px] text-red-500/90'>
										{errorMessage}
									</p>
								)}
							</div>
						</div>
					) : (
						<div className='flex items-center justify-center py-20'>
							<div className='flex flex-col items-center gap-2 rounded-xl border border-dashed border-[rgba(38,35,29,0.16)] bg-white/50 p-5 text-center text-sm text-[#9A9286]'>
								<FileTextIcon className='size-8 text-[#9A9286]' />
								<p>请先上传文件并等待处理完成</p>
							</div>
						</div>
					)}
				</section>

				{/* JSON panel */}
				<section className={cn('tab-panel', activeTab === 'json' && 'active')}>
					{response && status === 'completed' ? (
						<div className='card json-card overflow-auto'>
							<JsonPreview json={response} />
						</div>
					) : status === 'pending' || status === 'processing' ? (
						<div className='space-y-2 p-4'>
							<Skeleton className='h-3 w-[60%]' />
							<Skeleton className='h-3 w-[82%]' />
							<Skeleton className='h-3 w-[54%]' />
							<Skeleton className='h-3 w-[76%]' />
						</div>
					) : (
						<div className='flex items-center justify-center py-20 text-sm text-[#9A9286]'>
							<p>暂无数据</p>
						</div>
					)}
				</section>

				{/* Formulas panel */}
				<section className={cn('tab-panel', activeTab === 'formulas' && 'active')}>
					{status === 'completed' ? (
						<FormulaPanel formulas={formulas} taskId={response?.task_id} />
					) : (
						<div className='flex items-center justify-center py-20'>
							<div className='rounded-xl border border-dashed border-[rgba(38,35,29,0.16)] bg-white/50 p-5 text-center text-sm text-[#9A9286]'>
								<p>暂无公式</p>
							</div>
						</div>
					)}
				</section>
			</div>
		</div>
	)
}
