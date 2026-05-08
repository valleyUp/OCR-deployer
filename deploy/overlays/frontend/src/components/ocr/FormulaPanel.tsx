import katex from 'katex'
import 'katex/dist/katex.min.css'
import { useEffect, useRef, useState } from 'react'
import { ChevronDownIcon, FileArchiveIcon, Sigma } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/libs/utils'
import {
	exportTaskFormulas,
	renderFormula,
	renderFormulaText,
	type FormulaFormat,
	type FormulaItem
} from '@/libs/api'
import { useOcrStore } from '@/store/useOcrStore'
import { toast } from 'sonner'

interface FormulaPanelProps {
	formulas: FormulaItem[]
	taskId?: string | number
}

type CopyFormat = 'latex' | 'mathml' | 'unicodemath'
type DownloadFormat = 'latex' | 'mathml' | 'png'

interface ExportPreset {
	key: string
	label: string
	formats: FormulaFormat[]
	filename: (taskId: string | number) => string
}

const COPY_LABELS: Record<CopyFormat, string> = {
	latex: '复制 LaTeX',
	mathml: '复制 MathML',
	unicodemath: '复制 UnicodeMath'
}

const COPY_SUCCESS: Record<CopyFormat, string> = {
	latex: 'LaTeX 已复制',
	mathml: 'MathML 已复制',
	unicodemath: 'UnicodeMath 已复制'
}

const DOWNLOAD_LABELS: Record<DownloadFormat, string> = {
	latex: '下载 TEX',
	mathml: '下载 MML',
	png: '下载 PNG'
}

const DOWNLOAD_EXTENSIONS: Record<DownloadFormat, string> = {
	latex: 'tex',
	mathml: 'mml',
	png: 'png'
}

const DOWNLOAD_MEDIA_TYPES: Record<DownloadFormat, string> = {
	latex: 'application/x-tex;charset=utf-8',
	mathml: 'application/mathml+xml;charset=utf-8',
	png: 'image/png'
}

const EXPORT_PRESETS: ExportPreset[] = [
	{
		key: 'all',
		label: '全部格式打包',
		formats: ['latex', 'mathml', 'unicodemath', 'png'],
		filename: id => `${id}-formulas.zip`
	},
	{
		key: 'latex',
		label: '仅 LaTeX 打包',
		formats: ['latex'],
		filename: id => `${id}-formulas-latex.zip`
	},
	{
		key: 'mathml',
		label: '仅 MathML 打包',
		formats: ['mathml'],
		filename: id => `${id}-formulas-mathml.zip`
	},
	{
		key: 'unicodemath',
		label: '仅 UnicodeMath 打包',
		formats: ['unicodemath'],
		filename: id => `${id}-formulas-unicodemath.zip`
	},
	{
		key: 'png',
		label: '仅 PNG 打包',
		formats: ['png'],
		filename: id => `${id}-formulas-png.zip`
	}
]

function saveBlob(blob: Blob, filename: string) {
	const url = URL.createObjectURL(blob)
	const a = document.createElement('a')
	a.href = url
	a.download = filename
	a.click()
	URL.revokeObjectURL(url)
}

function FormulaPreview({ latex }: { latex: string }) {
	const markup = katex.renderToString(latex || '', {
		displayMode: true,
		throwOnError: false,
		strict: false,
		output: 'html'
	})
	return (
		<div
			className='overflow-auto rounded-md border border-gray-200 bg-white px-3 py-3 text-gray-900 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100'
			dangerouslySetInnerHTML={{ __html: markup }}
		/>
	)
}

function ExportMenu({
	taskId,
	disabled
}: {
	taskId?: string | number
	disabled?: boolean
}) {
	const [open, setOpen] = useState(false)
	const [busyKey, setBusyKey] = useState<string | null>(null)
	const containerRef = useRef<HTMLDivElement>(null)

	useEffect(() => {
		if (!open) return
		const onPointerDown = (event: MouseEvent) => {
			if (!containerRef.current?.contains(event.target as Node)) {
				setOpen(false)
			}
		}
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') setOpen(false)
		}
		window.addEventListener('mousedown', onPointerDown)
		window.addEventListener('keydown', onKeyDown)
		return () => {
			window.removeEventListener('mousedown', onPointerDown)
			window.removeEventListener('keydown', onKeyDown)
		}
	}, [open])

	const runExport = async (preset: ExportPreset) => {
		if (!taskId) return
		setBusyKey(preset.key)
		try {
			const blob = await exportTaskFormulas(taskId, preset.formats)
			saveBlob(blob, preset.filename(taskId))
			toast.success(`${preset.label}已开始下载`)
			setOpen(false)
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error)
			toast.error(`导出失败：${message}`)
		} finally {
			setBusyKey(null)
		}
	}

	return (
		<div ref={containerRef} className='relative'>
			<Button
				variant='outline'
				size='sm'
				disabled={disabled || !taskId}
				onClick={() => setOpen(value => !value)}
				aria-haspopup='menu'
				aria-expanded={open}>
				<FileArchiveIcon className='size-4' />
				批量导出
				<ChevronDownIcon
					className={cn(
						'size-3.5 transition-transform',
						open && 'rotate-180'
					)}
				/>
			</Button>
			{open && (
				<div
					role='menu'
					className='absolute right-0 z-20 mt-1 w-56 overflow-hidden rounded-md border border-gray-200 bg-white shadow-lg dark:border-gray-800 dark:bg-gray-900'>
					{EXPORT_PRESETS.map(preset => (
						<button
							key={preset.key}
							type='button'
							role='menuitem'
							disabled={busyKey !== null}
							onClick={() => void runExport(preset)}
							className='flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm text-gray-700 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-60 dark:text-gray-200 dark:hover:bg-gray-800'>
							<span>{preset.label}</span>
							{busyKey === preset.key && (
								<span className='text-xs text-gray-400'>导出中…</span>
							)}
						</button>
					))}
				</div>
			)}
		</div>
	)
}

export function FormulaPanel({ formulas, taskId }: FormulaPanelProps) {
	const blocks = useOcrStore(s => s.blocks)
	const setHoveredBlockId = useOcrStore(s => s.setHoveredBlockId)
	const setClickedBlockId = useOcrStore(s => s.setClickedBlockId)
	const copyCacheRef = useRef<Map<string, string>>(new Map())
	const [copyBusy, setCopyBusy] = useState<string | null>(null)
	const [downloadBusy, setDownloadBusy] = useState<string | null>(null)

	const activateFormula = (formula: FormulaItem, click = false) => {
		const numericBlockId = Number(formula.block_id)
		const block = blocks.find(
			item =>
				item.formulaId === formula.formula_id ||
				(!Number.isNaN(numericBlockId) && item.id === numericBlockId)
		)
		if (!block) return
		if (click) {
			setClickedBlockId(block.id)
		} else {
			setHoveredBlockId(block.id)
		}
	}

	const copyFormula = async (formula: FormulaItem, format: CopyFormat) => {
		const cacheKey = `${formula.formula_id || ''}:${format}`
		const busyKey = `${formula.formula_id || ''}|${format}`
		setCopyBusy(busyKey)
		try {
			let text = copyCacheRef.current.get(cacheKey)
			if (!text) {
				text = await renderFormulaText(formula.latex, format)
				copyCacheRef.current.set(cacheKey, text)
			}
			await navigator.clipboard.writeText(text)
			toast.success(COPY_SUCCESS[format])
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error)
			toast.error(`复制失败：${message}`)
		} finally {
			setCopyBusy(null)
		}
	}

	const downloadFormula = async (formula: FormulaItem, format: DownloadFormat) => {
		const busyKey = `${formula.formula_id || ''}|${format}`
		setDownloadBusy(busyKey)
		try {
			const blob =
				format === 'latex'
					? new Blob([formula.latex], { type: DOWNLOAD_MEDIA_TYPES[format] })
					: await renderFormula(formula.latex, format)
			const formulaId = formula.formula_id || 'formula'
			saveBlob(blob, `${formulaId}.${DOWNLOAD_EXTENSIONS[format]}`)
			toast.success(`${DOWNLOAD_LABELS[format]}已开始下载`)
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error)
			toast.error(`下载失败：${message}`)
		} finally {
			setDownloadBusy(null)
		}
	}

	if (!formulas.length) {
		return (
			<div className='h-full flex items-center justify-center bg-gray-50 dark:bg-gray-950'>
				<div className='rounded-lg p-4 text-center text-gray-500 dark:text-gray-400'>
					<p>暂无公式</p>
				</div>
			</div>
		)
	}

	return (
		<div className='h-full overflow-auto bg-gray-50 dark:bg-gray-950'>
			<div className='sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-gray-200 bg-white px-4 py-3 dark:border-gray-800 dark:bg-gray-900'>
				<div className='flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-200'>
					<Sigma className='size-4' />
					<span>{formulas.length} 个公式</span>
				</div>
				<ExportMenu taskId={taskId} />
			</div>

			<div className='divide-y divide-gray-200 dark:divide-gray-800'>
				{formulas.map((formula, index) => {
					const key = formula.formula_id || `${formula.page_index}-${index}`
					return (
						<div
							key={key}
							className='bg-white px-4 py-4 transition-colors hover:bg-gray-50 dark:bg-gray-900 dark:hover:bg-gray-800/60'
							onMouseEnter={() => activateFormula(formula)}
							onMouseLeave={() => setHoveredBlockId(null)}
							onClick={() => activateFormula(formula, true)}>
							<div className='mb-3 flex flex-wrap items-center justify-between gap-2'>
								<div className='flex items-center gap-2'>
									<Badge variant='outline'>P{formula.page_index}</Badge>
									<span className='text-xs text-gray-500 dark:text-gray-400'>
										{formula.formula_id}
									</span>
								</div>
								<div className='flex flex-wrap items-center gap-1'>
									{(Object.keys(COPY_LABELS) as CopyFormat[]).map(format => {
										const busyKey = `${formula.formula_id || ''}|${format}`
										const isBusy = copyBusy === busyKey
										return (
											<Button
												key={format}
												variant='outline'
												size='sm'
												disabled={isBusy}
												onClick={event => {
													event.stopPropagation()
													void copyFormula(formula, format)
												}}>
												{isBusy ? '复制中…' : COPY_LABELS[format]}
											</Button>
										)
									})}
									{(Object.keys(DOWNLOAD_LABELS) as DownloadFormat[]).map(format => {
										const busyKey = `${formula.formula_id || ''}|${format}`
										const isBusy = downloadBusy === busyKey
										return (
											<Button
												key={format}
												variant='outline'
												size='sm'
												disabled={isBusy}
												onClick={event => {
													event.stopPropagation()
													void downloadFormula(formula, format)
												}}>
												{isBusy ? '下载中…' : DOWNLOAD_LABELS[format]}
											</Button>
										)
									})}
								</div>
							</div>
							<FormulaPreview latex={formula.latex} />
						</div>
					)
				})}
			</div>
		</div>
	)
}
