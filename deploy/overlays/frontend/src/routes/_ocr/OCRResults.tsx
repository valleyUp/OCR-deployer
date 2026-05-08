import { useEffect, useMemo, useRef, useState } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { TaskResponse } from './FileUpload'
import { MarkdownPreview } from '@/components/ocr/MarkdownPreview'
import { useOcrStore } from '../../store/useOcrStore'
import {
	AppWindowIcon,
	CheckIcon,
	CopyIcon,
	DownloadIcon,
	FileJsonIcon,
	FileTextIcon,
	Hash,
	Layers,
	Sigma,
	Timer,
	Workflow
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
			<Skeleton className='h-6 w-[45%]' />
			<div className='space-y-2'>
				<Skeleton className='h-3.5 w-[92%]' />
				<Skeleton className='h-3.5 w-[88%]' />
				<Skeleton className='h-3.5 w-[70%]' />
			</div>
			<Skeleton className='h-40 w-full rounded-lg' />
			<div className='space-y-2'>
				<Skeleton className='h-3.5 w-[84%]' />
				<Skeleton className='h-3.5 w-[94%]' />
				<Skeleton className='h-3.5 w-[60%]' />
			</div>
			<Skeleton className='h-24 w-full rounded-lg' />
		</div>
	)
}

export function OCRResults({ result, fileName }: OCRResultsProps) {
	const setBlocks = useOcrStore(s => s.setBlocks)

	const [activeTab, setActiveTab] = useState<ResultTab>('markdown')
	const autoSwitchedRef = useRef(false)
	const autoSwitchTaskRef = useRef<string | number | null>(null)

	const [copiedAt, setCopiedAt] = useState<'copy' | 'download' | null>(null)

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

	const handleCopy = async () => {
		if (!result?.response?.full_markdown) return
		try {
			await navigator.clipboard.writeText(result.response.full_markdown)
			setCopiedAt('copy')
			toast.success('Markdown 已复制')
			window.setTimeout(() => setCopiedAt(null), 1200)
		} catch {
			toast.error('复制失败')
		}
	}

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
		setCopiedAt('download')
		toast.success('下载已开始')
		window.setTimeout(() => setCopiedAt(null), 1200)
	}

	const response = result?.response
	const status = result?.status
	const errorMessage = result?.error_message

	const metadata = response?.metadata
	const totalPages = metadata?.total_pages ?? layout.reduce((max: number, b: any) => Math.max(max, b.page_index ?? 1), 0)
	const totalChars = response?.full_markdown?.length ?? 0
	const executionSeconds = response?.result?.execution_time
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
					totalChars
						? {
								key: 'chars',
								icon: Hash,
								label: `${totalChars.toLocaleString()} 字`
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
		<div className='flex h-full flex-col bg-white'>
			<Tabs
				value={activeTab}
				onValueChange={value => setActiveTab(value as ResultTab)}
				className='flex flex-1 flex-col overflow-hidden'>
				<div className='sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-border bg-white/95 px-4 py-3 backdrop-blur-sm'>
					<TabsList className='h-9 gap-0.5 rounded-full bg-zinc-100 p-1'>
						<TabsTrigger
							value='markdown'
							className='h-7 cursor-pointer rounded-full px-3 text-[12.5px] font-medium transition-[background-color,color,box-shadow] duration-200 data-[state=active]:bg-white data-[state=active]:shadow-sm'>
							<AppWindowIcon className='size-3.5' />
							Markdown
						</TabsTrigger>
						<TabsTrigger
							value='json'
							className='h-7 cursor-pointer rounded-full px-3 text-[12.5px] font-medium transition-[background-color,color,box-shadow] duration-200 data-[state=active]:bg-white data-[state=active]:shadow-sm'>
							<FileJsonIcon className='size-3.5' />
							JSON
						</TabsTrigger>
						<TabsTrigger
							value='formulas'
							className='h-7 cursor-pointer rounded-full px-3 text-[12.5px] font-medium transition-[background-color,color,box-shadow] duration-200 data-[state=active]:bg-white data-[state=active]:shadow-sm'>
							<Sigma className='size-3.5' />
							公式
						</TabsTrigger>
					</TabsList>

					{status === 'completed' && (
						<div className='flex items-center gap-1.5'>
							<Button
								variant='ghost'
								size='icon-sm'
								className='text-muted-foreground hover:text-foreground'
								aria-label='复制 Markdown'
								onClick={handleCopy}>
								{copiedAt === 'copy' ? (
									<CheckIcon className='size-4 text-emerald-600' />
								) : (
									<CopyIcon className='size-4' />
								)}
							</Button>
							<Button
								variant='ghost'
								size='icon-sm'
								className='text-muted-foreground hover:text-foreground'
								aria-label='下载 Markdown'
								onClick={handleDownload}>
								{copiedAt === 'download' ? (
									<CheckIcon className='size-4 text-emerald-600' />
								) : (
									<DownloadIcon className='size-4' />
								)}
							</Button>
						</div>
					)}
				</div>

				{metaBadges.length > 0 && (
					<div className='flex flex-wrap items-center gap-1.5 border-b border-border bg-white/80 px-4 py-2'>
						{metaBadges.map(item => {
							const Icon = item.icon
							return (
								<Badge
									key={item.key}
									variant='outline'
									className='h-6 gap-1 rounded-full border-border px-2 text-[11px] font-normal text-muted-foreground'>
									<Icon className='size-3' />
									{item.label}
								</Badge>
							)
						})}
					</div>
				)}

				<div className='flex-1 overflow-hidden'>
					<TabsContent value='markdown' className='h-full m-0 mt-0'>
						{status === 'pending' || status === 'processing' ? (
							<div className='h-full overflow-auto'>
								<MarkdownSkeleton />
							</div>
						) : blocks.length > 0 && status === 'completed' ? (
							<MarkdownPreview />
						) : status === 'completed' ? (
							<div className='flex h-full items-center justify-center'>
								<div className='rounded-lg p-4 text-center text-sm text-muted-foreground'>
									<p>暂无 Markdown 内容</p>
								</div>
							</div>
						) : status === 'failed' ? (
							<div className='flex h-full items-center justify-center'>
								<div className='max-w-xs rounded-lg border border-red-200 bg-red-50 p-4 text-center text-sm text-red-600'>
									<p className='font-medium'>解析失败</p>
									{errorMessage && (
										<p className='mt-1 break-all text-[12px] text-red-500/90'>
											{errorMessage}
										</p>
									)}
								</div>
							</div>
						) : (
							<div className='flex h-full items-center justify-center'>
								<div className='flex flex-col items-center gap-2 rounded-lg p-4 text-center text-sm text-muted-foreground'>
									<FileTextIcon className='size-8 text-muted-foreground/60' />
									<p>请先上传文件并等待处理完成</p>
								</div>
							</div>
						)}
					</TabsContent>

					<TabsContent value='json' className='h-full m-0 mt-0 overflow-auto'>
						<div className={cn('p-4')}>
							{response && status === 'completed' ? (
								<div className='overflow-auto rounded-lg bg-zinc-50 p-4'>
									<JsonPreview json={response} />
								</div>
							) : status === 'pending' || status === 'processing' ? (
								<div className='space-y-2'>
									<Skeleton className='h-3 w-[60%]' />
									<Skeleton className='h-3 w-[82%]' />
									<Skeleton className='h-3 w-[54%]' />
									<Skeleton className='h-3 w-[76%]' />
								</div>
							) : (
								<div className='flex h-full items-center justify-center text-sm text-muted-foreground'>
									<p>暂无数据</p>
								</div>
							)}
						</div>
					</TabsContent>

					<TabsContent value='formulas' className='h-full m-0 mt-0 overflow-hidden'>
						{status === 'completed' ? (
							<FormulaPanel formulas={formulas} taskId={response?.task_id} />
						) : (
							<div className='flex h-full items-center justify-center'>
								<div className='rounded-lg p-4 text-center text-sm text-muted-foreground'>
									<p>暂无公式</p>
								</div>
							</div>
						)}
					</TabsContent>
				</div>
			</Tabs>
		</div>
	)
}
