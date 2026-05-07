import { useEffect, useMemo } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { TaskResponse } from './FileUpload'
import { MarkdownPreview } from '@/components/ocr/MarkdownPreview'
import { useOcrStore } from '../../store/useOcrStore'
import { AppWindowIcon, CopyIcon, DownloadIcon, FileJsonIcon, Sigma } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { JsonPreview } from '@/components/ocr/JsonPreview'
import { FormulaPanel } from '@/components/ocr/FormulaPanel'
import type { FormulaItem } from '@/libs/api'
// import { data as mockData } from './data'

interface OCRResultsProps {
	result: TaskResponse | null
	fileName?: string
}

export function OCRResults({ result, fileName }: OCRResultsProps) {
	const setBlocks = useOcrStore(s => s.setBlocks)

	// 从真实数据中获取 layout 和 images，如果没有则使用 mock 数据
	const layout = useMemo(() => result?.response?.layout || [], [result?.response?.layout])
	const images = useMemo(() => result?.response?.images || {}, [result?.response?.images])


	// 获取 PDF 单页高度	
	const pageHeight = result?.response?.metadata?.height ?? 2339

	const formulas = useMemo<FormulaItem[]>(() => {
		const responseFormulas = result?.response?.formulas
		if (responseFormulas?.length) {
			return responseFormulas
		}

		return layout
			.filter((b: any) => b.formula?.latex || b.layout_type === 'formula')
			.map((b: any, index: number) => ({
				formula_id: b.formula_id || `formula-p${b.page_index ?? 1}-b${b.block_id ?? index + 1}`,
				task_id: result?.response?.task_id,
				block_id: b.block_id,
				page_index: b.page_index ?? 1,
				bbox: b.bbox ?? null,
				layout_type: b.layout_type,
				latex: b.formula?.latex || String(b.block_content || '').replace(/^\$\$|\\\[|\\\(|\$\$$|\\\]|\\\)$/g, '').trim(),
				formula: b.formula
			}))
	}, [layout, result?.response?.formulas, result?.response?.task_id])

	// 将 layout 转换为 blocks 格式（过滤掉只有 # 的内容，保留图片）
	const blocks = useMemo(() => {
		if (result?.status !== 'completed') {
			return []
		}
		return layout
			.filter((b: any) => {
				// 过滤掉空内容或只有 # 的内容
				if (!b.block_content || b.block_content.trim() === '') {
					return false
				}
				return true
			})
			.map((b: any, index: number) => {
				const blockContent = b.block_content.trim()

				// 处理 bbox 坐标 - 始终使用相对坐标（每页内的坐标）
				let bbox: [number, number, number, number] | null = null
				let width = 0
				let height = 0
				if (b.bbox) {
					const [x1, y1, x2, y2] = b.bbox as [number, number, number, number]
					width = x2 - x1
					height = y2 - y1

					// 始终使用相对坐标（每页内的坐标）
					bbox = [x1, y1, x2, y2]
				}

				return {
					id: b.block_id ?? index + Math.random() * 1000000,
					content: blockContent,
					bbox,
					pageIndex: b.page_index ?? 1,
					isImage: blockContent.startsWith('![]('), // 标记是否为图片
					layoutType: b.layout_type,
					formulaId: b.formula_id,
					latex: b.formula?.latex,
					width: width,
					height: height
				}
			})
	}, [layout, images, pageHeight, result?.status])

	// 将 blocks 设置到 store
	useEffect(() => {
		if (result?.status === 'completed') {
			setBlocks(blocks)
		}
	}, [blocks, result?.status, setBlocks])

	const handleCopy = () => {
		if (!result?.response?.full_markdown) return
		navigator.clipboard.writeText(result.response.full_markdown)
		toast.success('复制成功')
	}

	const handleDownload = () => {
		if (!result?.response?.full_markdown) return
		const blob = new Blob([result.response.full_markdown], { type: 'text/markdown' })
		const url = URL.createObjectURL(blob)
		const a = document.createElement('a')
		a.href = url
		a.download = `${fileName || 'result'}.md`
		a.click()
		URL.revokeObjectURL(url)
		toast.success('下载成功')
	}

	const response = result?.response
	const status = result?.status
	const error_message = result?.error_message

	return (
		<div className='h-screen flex flex-col bg-white border-l border-border'>
			<Tabs defaultValue='markdown' className='flex-1 flex flex-col overflow-hidden'>
				{/* 固定在顶部的 TabsList */}
				<div className='px-4 pt-4 pb-0 bg-white sticky top-0 z-10 flex items-center justify-between'>
					<TabsList className='grid grid-cols-3'>
						<TabsTrigger value='markdown' className='cursor-pointer'>
							<AppWindowIcon className='size-4' />Markdown</TabsTrigger>
						<TabsTrigger value='json' className='cursor-pointer'>
							<FileJsonIcon className='size-4' />JSON</TabsTrigger>
						<TabsTrigger value='formulas' className='cursor-pointer'>
							<Sigma className='size-4' />公式</TabsTrigger>
					</TabsList>
					{status === 'completed' && <div className='flex items-center gap-2'>
						<Button variant="outline" size="icon" className='cursor-pointer' onClick={() => handleCopy()}>
							<CopyIcon className='size-4' />
						</Button>
						<Button variant="outline" size="icon" className='cursor-pointer' onClick={() => handleDownload()}>
							<DownloadIcon className='size-4' />
						</Button>
					</div>}
				</div>

				{/* 可滚动的内容区域 */}
				<div className='flex-1 overflow-hidden'>
					<TabsContent value='markdown' className='h-full m-0 mt-0'>
						{/* 解析中状态 */}
						{status === 'pending' || status === 'processing' ? (
							<div className='h-full flex items-center justify-center'>
								<div className='text-center'>
									<div className='inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary mb-4'></div>
									<p className='text-gray-500 dark:text-gray-400'>
										正在解析中...
									</p>
								</div>
							</div>
						) : blocks.length > 0 && status === 'completed' ? (
							// 解析成功，显示结果
							<MarkdownPreview />
						) : status === 'completed' ? (
							// 解析完成但没有内容
							<div className='h-full flex items-center justify-center'>
								<div className='p-4 rounded-lg text-center text-gray-500 dark:text-gray-400'>
									<p>暂无 Markdown 内容</p>
								</div>
							</div>
						) : status === 'failed' ? (
							// 解析失败
							<div className='h-full flex items-center justify-center'>
								<div className='p-4 rounded-lg text-center text-red-500 dark:text-red-400'>
									<p>解析失败</p>
									{error_message && (
										<p className='text-sm mt-2 text-gray-500 dark:text-gray-400'>
											{error_message}
										</p>
									)}
								</div>
							</div>
						) : (
							// 未上传文件
							<div className='h-full flex items-center justify-center'>
								<div className='p-4 rounded-lg text-center text-gray-500 dark:text-gray-400'>
									<p>请先上传文件并等待处理完成</p>
								</div>
							</div>
						)}
					</TabsContent>

					<TabsContent value='json' className='h-full m-0 mt-0 overflow-auto'>
						<div className='p-4'>
							{response && status === 'completed' && result?.response ? (
								<div className='bg-gray-100 dark:bg-gray-800 p-4 rounded-lg overflow-auto'>
									<JsonPreview json={response} />
								</div>
							) : (
								<div className='h-full flex items-center justify-center'>
									<div className='p-4 rounded-lg text-center text-gray-500 dark:text-gray-400'>
										<p>暂无数据</p>
									</div>
								</div>
							)}
						</div>
					</TabsContent>

					<TabsContent value='formulas' className='h-full m-0 mt-0 overflow-hidden'>
						{status === 'completed' ? (
							<FormulaPanel formulas={formulas} taskId={response?.task_id} />
						) : (
							<div className='h-full flex items-center justify-center'>
								<div className='p-4 rounded-lg text-center text-gray-500 dark:text-gray-400'>
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
