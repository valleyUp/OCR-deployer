import { useMemo, useState } from 'react'
import { HelpCircle, Sigma } from 'lucide-react'
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
		<header className='sticky top-0 z-40 flex h-[60px] shrink-0 items-center justify-between border-b border-border bg-background/88 px-8 backdrop-blur-lg'>
			<div className='flex items-center gap-4'>
				<span className='flex size-[34px] items-center justify-center rounded-[11px] bg-gradient-to-br from-primary to-[#A8875A] text-card text-[19px] shadow-sm'
					style={{ fontFamily: 'var(--font-display)', fontStyle: 'italic' }}>
					G
				</span>
				<div className='flex flex-col leading-none'>
					<span className='text-[22px] italic tracking-tight text-foreground'
						style={{ fontFamily: 'var(--font-display)', letterSpacing: '-0.015em' }}>
						GLM-OCR
					</span>
					<span className='mt-0.5 text-[9.5px] uppercase tracking-[.2em] text-muted-foreground'
						style={{ fontFamily: 'var(--font-mono)' }}>
						Studio
					</span>
				</div>
			</div>

			<div className='flex items-center gap-2'>
				<Badge
					variant='outline'
					className='h-[32px] gap-2 rounded-full border-border bg-muted/50 px-3.5 text-[12.5px] font-medium text-muted-foreground transition-all duration-150 hover:-translate-y-px hover:bg-card hover:text-foreground hover:shadow-sm'>
					<span
						className={cn(
							'size-1.5 rounded-full',
							activeMode === 'formula' ? 'bg-primary' : 'bg-[#5B8A6F]'
						)}
						style={activeMode === 'formula' ? { boxShadow: '0 0 0 3px rgba(139,111,71,.22)' } : { boxShadow: '0 0 0 3px rgba(91,138,111,.20)' }}
					/>
					{modeLabel}
				</Badge>

				<Dialog open={helpOpen} onOpenChange={setHelpOpen}>
					<DialogTrigger asChild>
						<Button
							variant='ghost'
							size='icon-sm'
							aria-label='打开帮助'
							className='size-[36px] rounded-[10px] text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-all duration-150 active:scale-[.94]'>
							<HelpCircle className='size-4' />
						</Button>
					</DialogTrigger>
					<DialogContent className='sm:max-w-[520px]'>
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
