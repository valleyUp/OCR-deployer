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
				<div className='brand'>
					<div className='logo-mark' aria-hidden='true'>G</div>
					<div className='brand-title'>
						<strong>GLM-OCR</strong>
						<span>{isFormula ? 'formula mode' : 'layout mode'}</span>
					</div>
				</div>

				<div className='nav-actions'>
					<Dialog open={helpOpen} onOpenChange={setHelpOpen}>
						<DialogTrigger asChild>
							<button className='icon-button interactive' aria-label='帮助'>
								<CircleHelp className='size-4' />
							</button>
						</DialogTrigger>
						<DialogContent className='border-[rgba(38,35,29,0.10)] bg-white/95 shadow-2xl backdrop-blur-2xl sm:max-w-[440px]'>
							<DialogHeader>
								<DialogTitle className='font-[family-name:var(--f-display)]'>GLM-OCR</DialogTitle>
								<DialogDescription>自托管 OCR 服务 · 支持文档与公式识别</DialogDescription>
							</DialogHeader>
							<div className='space-y-4 text-sm text-[#26231D]/85'>
								<section className='space-y-1.5'>
									<h3 className='text-xs font-semibold uppercase tracking-wide text-[#9A9286]'>支持格式</h3>
									<p>PNG / JPG / PDF，最大 20 MB · 支持拖拽、点击或从剪贴板粘贴</p>
								</section>
								<section className='space-y-1.5'>
									<h3 className='text-xs font-semibold uppercase tracking-wide text-[#9A9286]'>处理模式</h3>
									<ul className='list-disc space-y-0.5 pl-5'>
										<li><b>文档 OCR</b> — 版面还原，输出 Markdown / JSON + bbox</li>
										<li><b>公式识别</b> — 提取 LaTeX，支持 MathML / UnicodeMath / PNG</li>
									</ul>
								</section>
								<section className='space-y-1.5'>
									<h3 className='text-xs font-semibold uppercase tracking-wide text-[#9A9286]'>快捷键</h3>
									<p><kbd>⌘V</kbd> / <kbd>Ctrl+V</kbd> 粘贴剪贴板图片直接上传</p>
								</section>
							</div>
						</DialogContent>
					</Dialog>
				</div>
			</div>
		</header>
	)
}
