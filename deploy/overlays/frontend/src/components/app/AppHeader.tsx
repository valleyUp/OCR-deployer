import { useEffect, useMemo, useState } from 'react'
import { CircleHelp } from 'lucide-react'
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

export function AppHeader({ uploadFile, result }: AppHeaderProps) {
	const [helpOpen, setHelpOpen] = useState(false)
	const [scrolled, setScrolled] = useState(false)

	const activeMode = useMemo(() => {
		const fromResult =
			result?.response?.processing_mode ||
			result?.response?.metadata?.processing_mode
		const fromUpload = uploadFile?.processingMode
		return (fromResult || fromUpload || 'pipeline') as string
	}, [result, uploadFile])

	const isFormula = activeMode === 'formula'

	useEffect(() => {
		const onScroll = () => setScrolled(window.scrollY > 8)
		window.addEventListener('scroll', onScroll, { passive: true })
		return () => window.removeEventListener('scroll', onScroll)
	}, [])

	return (
		<header className={cn('topbar', scrolled && 'scrolled')}>
			<div className='nav-inner'>
				{/* Brand */}
				<div className='brand'>
					<div
						className={cn(
							'logo-mark transition-colors duration-300',
							isFormula && 'bg-violet-500'
						)}
						aria-hidden='true'>
						G
					</div>
					<div className='brand-title'>
						<strong>GLM-OCR Console</strong>
						<span>{isFormula ? 'selfhosted / formula' : 'selfhosted / layout'}</span>
					</div>
				</div>

				{/* Nav tabs — sliding pill */}
				<div className='nav-tabs' role='tablist' aria-label='全局视图'>
					<span className='nav-thumb' aria-hidden='true' />
					<button className='nav-tab interactive' role='tab' aria-selected='true'>
						Workbench
					</button>
					<button className='nav-tab interactive' role='tab' aria-selected='false'>
						Jobs
					</button>
					<button className='nav-tab interactive' role='tab' aria-selected='false'>
						Models
					</button>
				</div>

				{/* Actions */}
				<div className='nav-actions'>
					<Dialog open={helpOpen} onOpenChange={setHelpOpen}>
						<DialogTrigger asChild>
							<button className='icon-button interactive' aria-label='帮助'>
								<CircleHelp className='size-4' />
							</button>
						</DialogTrigger>
						<DialogContent className='border-[rgba(38,35,29,0.10)] bg-white/95 shadow-2xl backdrop-blur-2xl sm:max-w-[480px]'>
							<DialogHeader>
								<DialogTitle className='font-[family-name:var(--f-display)]'>使用说明</DialogTitle>
								<DialogDescription>常用操作与支持范围</DialogDescription>
							</DialogHeader>
							<div className='space-y-4 text-sm'>
								<section className='space-y-2'>
									<h3 className='text-xs font-semibold uppercase tracking-wide text-[#9A9286]'>
										支持格式
									</h3>
									<p className='text-[#26231D]/85'>
										PNG / JPG / JPEG / PDF，最大 20 MB。
									</p>
								</section>
								<section className='space-y-2'>
									<h3 className='text-xs font-semibold uppercase tracking-wide text-[#9A9286]'>
										处理模式
									</h3>
									<ul className='list-disc space-y-1 pl-5 text-[#26231D]/85'>
										<li>
											<b>文档 OCR</b>：版面还原，输出 Markdown / JSON + bbox。
										</li>
										<li>
											<b>公式识别</b>：识别后可复制 LaTeX / MathML / UnicodeMath。
										</li>
									</ul>
								</section>
								<section className='space-y-2'>
									<h3 className='text-xs font-semibold uppercase tracking-wide text-[#9A9286]'>
										快捷键
									</h3>
									<div className='grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2'>
										<span className='flex gap-1'>
											<kbd>⌘</kbd>
											<span className='text-[#9A9286]'>/</span>
											<kbd>Ctrl</kbd>
											<kbd>V</kbd>
										</span>
										<span className='text-[#26231D]/85'>粘贴剪贴板图片直接上传</span>
									</div>
								</section>
							</div>
						</DialogContent>
					</Dialog>
				</div>
			</div>
		</header>
	)
}
