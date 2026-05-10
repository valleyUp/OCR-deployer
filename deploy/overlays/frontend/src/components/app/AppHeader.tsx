import { useMemo, useState } from 'react'
import { CircleHelp, FileText, Sigma } from 'lucide-react'
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
			result?.response?.processing_mode ||
			result?.response?.metadata?.processing_mode
		const fromUpload = uploadFile?.processingMode
		return (fromResult || fromUpload || 'pipeline') as string
	}, [result, uploadFile])

	const isFormula = activeMode === 'formula'

	return (
		<header className='ios-glass-toolbar sticky top-0 z-40 flex h-14 shrink-0 items-center justify-between px-5'>
			{/* Brand — simple, confident */}
			<div className='flex items-center gap-3'>
				<span
					className={cn(
						'flex size-8 items-center justify-center rounded-xl text-white shadow-sm transition-colors duration-300',
						isFormula
							? 'bg-gradient-to-br from-violet-500 to-violet-600 shadow-violet-500/20'
							: 'bg-gradient-to-br from-blue-500 to-blue-600 shadow-blue-500/20'
					)}>
					<Sigma className='size-4' />
				</span>
				<span className='text-[15px] font-semibold tracking-tight text-[#0d0d12]'>
					GLM-OCR
				</span>
			</div>

			{/* Status + help */}
			<div className='flex items-center gap-1.5'>
				{/* Live processing mode indicator — subtle, informative */}
				<div className='ios-pill h-7 gap-1.5 px-3 text-[12px] font-medium'>
					<span
						className={cn(
							'size-2 rounded-full transition-colors duration-300',
							isFormula ? 'bg-violet-500' : 'bg-emerald-500'
						)}
					/>
					{isFormula ? (
						<span className='flex items-center gap-1'>
							<Sigma className='size-3 text-violet-500' />
							公式
						</span>
					) : (
						<span className='flex items-center gap-1'>
							<FileText className='size-3 text-blue-500' />
							文档
						</span>
					)}
				</div>

				<Dialog open={helpOpen} onOpenChange={setHelpOpen}>
					<DialogTrigger asChild>
						<Button
							variant='ghost'
							size='icon-sm'
							aria-label='帮助'
							className='ios-btn-icon size-8 rounded-full text-[#8e8e96] hover:text-[#0d0d12]'>
							<CircleHelp className='size-4' />
						</Button>
					</DialogTrigger>
					<DialogContent className='border-[rgba(0,0,0,0.06)] bg-white/92 shadow-2xl backdrop-blur-2xl sm:max-w-[480px]'>
						<DialogHeader>
							<DialogTitle>使用说明</DialogTitle>
							<DialogDescription>常用操作与支持范围</DialogDescription>
						</DialogHeader>
						<div className='space-y-4 text-sm'>
							<section className='space-y-2'>
								<h3 className='text-xs font-semibold uppercase tracking-wide text-[#8e8e96]'>
									支持格式
								</h3>
								<p className='text-[#0d0d12]/85'>
									PNG / JPG / JPEG / PDF，最大 20 MB。
								</p>
							</section>
							<section className='space-y-2'>
								<h3 className='text-xs font-semibold uppercase tracking-wide text-[#8e8e96]'>
									处理模式
								</h3>
								<ul className='list-disc space-y-1 pl-5 text-[#0d0d12]/85'>
									<li>
										<b>文档 OCR</b>：版面还原，输出 Markdown / JSON + bbox。
									</li>
									<li>
										<b>公式识别</b>：识别后可复制 LaTeX / MathML / UnicodeMath。
									</li>
								</ul>
							</section>
							<section className='space-y-2'>
								<h3 className='text-xs font-semibold uppercase tracking-wide text-[#8e8e96]'>
									快捷键
								</h3>
								<div className='grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2'>
									<span className='flex gap-1'>
										<kbd>⌘</kbd>
										<span className='text-[#8e8e96]'>/</span>
										<kbd>Ctrl</kbd>
										<kbd>V</kbd>
									</span>
									<span className='text-[#0d0d12]/85'>粘贴剪贴板图片直接上传</span>
								</div>
							</section>
						</div>
					</DialogContent>
				</Dialog>
			</div>
		</header>
	)
}
