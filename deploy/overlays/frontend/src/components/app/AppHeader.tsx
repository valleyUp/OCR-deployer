import { useMemo, useState } from 'react'
import { CircleHelp, FileText, Radio, Sigma, Sparkles } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger
} from '@/components/ui/dialog'
import { cn } from '@/libs/utils'
import type { TaskResponse, UploadedFile } from '@/routes/_ocr/FileUpload'

interface AppHeaderProps {
	uploadFile: UploadedFile | null
	result: TaskResponse | null
}

const MODE_LABELS: Record<string, string> = {
	pipeline: '文档 OCR',
	formula: '公式识别'
}

export function AppHeader({ uploadFile, result }: AppHeaderProps) {
	const [helpOpen, setHelpOpen] = useState(false)

	const activeMode = useMemo(() => {
		const fromResult =
			result?.response?.processing_mode || result?.response?.metadata?.processing_mode
		const fromUpload = uploadFile?.processingMode
		return (fromResult || fromUpload || 'pipeline') as string
	}, [result, uploadFile])

	const modeLabel = MODE_LABELS[activeMode] ?? activeMode

	return (
		<header className='ocr-panel-toolbar sticky top-0 z-40 flex h-16 shrink-0 items-center justify-between px-5'>
			<div className='flex min-w-0 items-center gap-4'>
				<div className='hidden items-center gap-2 lg:flex' aria-hidden='true'>
					<span className='size-3 rounded-full bg-[#ff5f57] shadow-[0_0_0_1px_rgba(0,0,0,0.08)]' />
					<span className='size-3 rounded-full bg-[#ffbd2e] shadow-[0_0_0_1px_rgba(0,0,0,0.08)]' />
					<span className='size-3 rounded-full bg-[#28c840] shadow-[0_0_0_1px_rgba(0,0,0,0.08)]' />
				</div>
				<div className='flex min-w-0 items-center gap-3'>
					<span className='relative flex size-9 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-600 via-cyan-500 to-emerald-400 text-white shadow-lg shadow-blue-500/20'>
						<Sigma className='size-5' />
						<span className='absolute -right-0.5 -top-0.5 size-2.5 rounded-full border border-white/80 bg-emerald-400' />
					</span>
					<div className='min-w-0'>
						<div className='flex items-baseline gap-2'>
							<span className='truncate text-[15px] font-semibold tracking-tight text-slate-950'>
								GLM-OCR Studio
							</span>
							<span className='hidden rounded-full bg-slate-950/5 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.16em] text-slate-500 xl:inline-flex'>
								Overlay
							</span>
						</div>
						<p className='truncate text-[11px] text-slate-500'>
							本地部署的文档与公式识别工作台
						</p>
					</div>
				</div>
			</div>

			<div className='hidden items-center gap-2 rounded-full border border-white/70 bg-white/50 px-2 py-1 shadow-sm xl:flex'>
				<span className='ocr-pill h-8 px-3 text-[12px] font-medium'>
					<Radio className='size-3.5 text-emerald-500' />
					本地资源
				</span>
				<span className='ocr-pill h-8 px-3 text-[12px] font-medium'>
					{activeMode === 'formula' ? (
						<Sparkles className='size-3.5 text-violet-500' />
					) : (
						<FileText className='size-3.5 text-blue-500' />
					)}
					{modeLabel}
				</span>
			</div>

			<div className='flex items-center gap-2'>
				<Badge
					variant='outline'
					className='ocr-pill h-8 gap-1.5 border-transparent px-3 text-[12px] font-medium text-slate-700 xl:hidden'>
					<span
						className={cn(
							'size-1.5 rounded-full',
							activeMode === 'formula' ? 'bg-violet-500' : 'bg-emerald-500'
						)}
					/>
					{modeLabel}
				</Badge>

				<Dialog open={helpOpen} onOpenChange={setHelpOpen}>
					<DialogTrigger asChild>
						<Button
							variant='ghost'
							size='icon-sm'
							aria-label='打开帮助'
							className='ocr-icon-button size-9 rounded-full text-slate-500 hover:bg-white hover:text-blue-600'>
							<CircleHelp className='size-4' />
						</Button>
					</DialogTrigger>
					<DialogContent className='border-white/70 bg-white/90 shadow-2xl backdrop-blur-xl sm:max-w-[520px]'>
						<DialogHeader>
							<DialogTitle>使用说明</DialogTitle>
							<DialogDescription>常用操作与支持范围</DialogDescription>
						</DialogHeader>
						<div className='space-y-4 text-sm'>
							<section className='space-y-2'>
								<h3 className='text-xs font-medium uppercase tracking-wide text-muted-foreground'>
									支持格式
								</h3>
								<p className='text-foreground/90'>
									PNG / JPG / JPEG / PDF ，最大 20 MB。
								</p>
							</section>
							<section className='space-y-2'>
								<h3 className='text-xs font-medium uppercase tracking-wide text-muted-foreground'>
									处理模式
								</h3>
								<ul className='list-disc space-y-1 pl-5 text-foreground/90'>
									<li>
										<b>文档 OCR</b>：版面还原，输出 Markdown / JSON + bbox，保留图片块。
									</li>
									<li>
										<b>公式识别</b>：识别后可复制 LaTeX / MathML / UnicodeMath，或一键打包导出。
									</li>
								</ul>
							</section>
							<section className='space-y-2'>
								<h3 className='text-xs font-medium uppercase tracking-wide text-muted-foreground'>
									快捷键
								</h3>
								<div className='grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2'>
									<span className='flex gap-1'>
										<kbd>⌘</kbd>
										<span className='text-muted-foreground'>/</span>
										<kbd>Ctrl</kbd>
										<kbd>V</kbd>
									</span>
									<span className='text-foreground/90'>粘贴剪贴板图片直接上传</span>
									<span className='flex gap-1'>
										<kbd>↑</kbd>
										<kbd>↓</kbd>
									</span>
									<span className='text-foreground/90'>公式面板上下切换卡片</span>
									<span className='flex gap-1'>
										<kbd>C</kbd>
										<span className='text-muted-foreground'>/</span>
										<kbd>M</kbd>
										<span className='text-muted-foreground'>/</span>
										<kbd>U</kbd>
									</span>
									<span className='text-foreground/90'>
										复制当前公式的 LaTeX / MathML / UnicodeMath
									</span>
									<span className='flex gap-1'>
										<kbd>←</kbd>
										<kbd>→</kbd>
									</span>
									<span className='text-foreground/90'>
										聚焦分隔条时调整结果区宽度，双击恢复默认
									</span>
								</div>
							</section>
						</div>
					</DialogContent>
				</Dialog>
			</div>
		</header>
	)
}
