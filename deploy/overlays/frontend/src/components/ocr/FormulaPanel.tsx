import katex from 'katex'
import 'katex/dist/katex.min.css'
import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState
} from 'react'
import {
	Check,
	ChevronDown,
	Download,
	FileArchive,
	Loader2,
	Search,
	Sigma,
	X
} from 'lucide-react'
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

interface ExportPreset {
	key: string
	label: string
	formats: FormulaFormat[]
	filename: (taskId: string | number) => string
}

const COPY_LABELS: Record<CopyFormat, string> = {
	latex: 'LaTeX',
	mathml: 'MathML',
	unicodemath: 'UnicodeMath'
}

const COPY_SUCCESS: Record<CopyFormat, string> = {
	latex: 'LaTeX 已复制',
	mathml: 'MathML 已复制',
	unicodemath: 'UnicodeMath 已复制'
}

const COPY_SHORTCUT: Record<CopyFormat, string> = {
	latex: 'C',
	mathml: 'M',
	unicodemath: 'U'
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

const DOWNLOAD_FORMATS: { format: FormulaFormat; label: string; ext: string; type: string }[] = [
	{ format: 'latex', label: 'TEX', ext: 'tex', type: 'text/x-tex;charset=utf-8' },
	{ format: 'mathml', label: 'MML', ext: 'mml', type: 'application/mathml+xml' },
	{ format: 'png', label: 'PNG', ext: 'png', type: 'image/png' }
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
	const markup = useMemo(
		() =>
			katex.renderToString(latex || '', {
				displayMode: true,
				throwOnError: false,
				strict: false,
				output: 'html'
			}),
		[latex]
	)
	return (
		<div
			className='ocr-formula-preview overflow-auto rounded-2xl border border-[rgba(0,0,0,0.08)] px-4 py-4 text-[#0d0d12] shadow-inner'
			dangerouslySetInnerHTML={{ __html: markup }}
		/>
	)
}

interface ExportMenuProps {
	taskId?: string | number
	disabled?: boolean
}

function ExportMenu({ taskId, disabled }: ExportMenuProps) {
	const [open, setOpen] = useState(false)
	const [busyKey, setBusyKey] = useState<string | null>(null)
	const containerRef = useRef<HTMLDivElement>(null)

	useEffect(() => {
		if (!open) return
		const onPointerDown = (event: MouseEvent) => {
			if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
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
				className='h-8 gap-1.5 rounded-full border-[rgba(0,0,0,0.08)] bg-white/80 px-3 text-[12px] font-semibold text-[#54545c] shadow-sm hover:bg-white'
				disabled={disabled || !taskId}
				onClick={() => setOpen(value => !value)}
				aria-haspopup='menu'
				aria-expanded={open}>
				<FileArchive className='size-4' />
				批量导出
				<ChevronDown
					className={cn(
						'size-3.5 transition-transform duration-200',
						open && 'rotate-180'
					)}
				/>
			</Button>
			{open && (
				<div
					role='menu'
					className='absolute right-0 z-20 mt-2 w-56 origin-top-right overflow-hidden rounded-2xl border border-[rgba(0,0,0,0.06)] bg-white/95 p-1 shadow-2xl shadow-black/5 backdrop-blur-xl motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-95 motion-safe:duration-150'>
					{EXPORT_PRESETS.map(preset => {
						const isBusy = busyKey === preset.key
						return (
							<button
								key={preset.key}
								type='button'
								role='menuitem'
								disabled={busyKey !== null}
								onClick={() => void runExport(preset)}
								className='flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-left text-sm text-[#54545c] transition-colors duration-150 hover:bg-[rgba(0,0,0,0.04)] disabled:cursor-not-allowed disabled:opacity-60'>
								<span className='flex items-center gap-2'>
									{isBusy && <Loader2 className='size-3.5 animate-spin text-primary' />}
									<span className={cn(isBusy && 'text-[#8e8e96]')}>
										{preset.label}
									</span>
								</span>
							</button>
						)
					})}
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
	const listRef = useRef<HTMLDivElement>(null)
	const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map())
	const [copyBusy, setCopyBusy] = useState<string | null>(null)
	const [downloadBusy, setDownloadBusy] = useState<string | null>(null)
	const [copiedKey, setCopiedKey] = useState<string | null>(null)
	const [downloadedKey, setDownloadedKey] = useState<string | null>(null)
	const [query, setQuery] = useState('')
	const [selectedKey, setSelectedKey] = useState<string | null>(null)

	const keyFor = (formula: FormulaItem, index: number) =>
		formula.formula_id || `${formula.page_index}-${index}`

	const filtered = useMemo(() => {
		const trimmed = query.trim().toLowerCase()
		if (!trimmed) return formulas
		return formulas.filter(f => {
			const latex = (f.latex || '').toLowerCase()
			const id = (f.formula_id || '').toLowerCase()
			return latex.includes(trimmed) || id.includes(trimmed)
		})
	}, [query, formulas])

	const scrollSelectedIntoView = (key: string | null) => {
		if (!key) return
		cardRefs.current.get(key)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
	}

	useEffect(() => {
		if (!filtered.length) {
			setSelectedKey(null)
			return
		}
		if (
			!selectedKey ||
			!filtered.some((f, i) => keyFor(f, i) === selectedKey)
		) {
			setSelectedKey(keyFor(filtered[0], 0))
		}
	}, [filtered, selectedKey])

	// When the user clicks a formula block in the preview, scroll to and
	// select the matching formula card (reverse of the current card→preview
	// direction). We only read store state here — no store writes — so this
	// cannot create a feedback loop.
	const clickedPdfBlockId = useOcrStore(s => s.clickedPdfBlockId)
	useEffect(() => {
		if (clickedPdfBlockId === null) return
		const block = blocks.find(b => b.id === clickedPdfBlockId)
		if (!block) return
		const matched = formulas.find(f => {
			if (f.formula_id && f.formula_id === block.formulaId) return true
			const numeric = Number(f.block_id)
			if (!Number.isNaN(numeric) && numeric === clickedPdfBlockId) return true
			return false
		})
		if (!matched) return
		const key = matched.formula_id || `${matched.page_index}-${formulas.indexOf(matched)}`
		setSelectedKey(key)
		requestAnimationFrame(() => scrollSelectedIntoView(key))
	}, [clickedPdfBlockId, formulas, blocks])

	const activateFormula = useCallback(
		(formula: FormulaItem, click = false) => {
			const numericBlockId = Number(formula.block_id)
			const block = blocks.find(
				item =>
					item.formulaId === formula.formula_id ||
					(!Number.isNaN(numericBlockId) && item.id === numericBlockId)
			)
			if (!block) return
			if (click) setClickedBlockId(block.id)
			else setHoveredBlockId(block.id)
		},
		[blocks, setClickedBlockId, setHoveredBlockId]
	)

	const copyFormula = useCallback(
		async (formula: FormulaItem, format: CopyFormat) => {
			const cardKey = formula.formula_id || ''
			const cacheKey = `${cardKey}:${format}`
			const busyKey = `${cardKey}|${format}`
			setCopyBusy(busyKey)
			try {
				let text = copyCacheRef.current.get(cacheKey)
				if (!text) {
					text = await renderFormulaText(formula.latex, format)
					copyCacheRef.current.set(cacheKey, text)
				}
				await navigator.clipboard.writeText(text)
				toast.success(COPY_SUCCESS[format])
				setCopiedKey(busyKey)
				window.setTimeout(() => {
					setCopiedKey(prev => (prev === busyKey ? null : prev))
				}, 1200)
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error)
				toast.error(`复制失败：${message}`)
			} finally {
				setCopyBusy(null)
			}
		},
		[]
	)

	const downloadFormula = useCallback(async (formula: FormulaItem, format: FormulaFormat) => {
		const config = DOWNLOAD_FORMATS.find(item => item.format === format)
		if (!config) return
		const cardKey = formula.formula_id || `${formula.page_index}-${formula.block_id ?? 'formula'}`
		const busyKey = `${cardKey}|${format}`
		setDownloadBusy(busyKey)
		try {
			const blob =
				format === 'latex'
					? new Blob([formula.latex], { type: config.type })
					: await renderFormula(formula.latex, format)
			saveBlob(blob, `${cardKey}.${config.ext}`)
			toast.success(`${config.label} 已开始下载`)
			setDownloadedKey(busyKey)
			window.setTimeout(() => {
				setDownloadedKey(prev => (prev === busyKey ? null : prev))
			}, 1200)
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error)
			toast.error(`下载失败：${message}`)
		} finally {
			setDownloadBusy(null)
		}
	}, [])

	const handleKeyDown: React.KeyboardEventHandler<HTMLDivElement> = event => {
		if (!filtered.length) return
		if (
			event.target instanceof HTMLInputElement ||
			event.target instanceof HTMLTextAreaElement
		) {
			return
		}
		const currentIndex = Math.max(
			0,
			filtered.findIndex((f, i) => keyFor(f, i) === selectedKey)
		)
		if (event.key === 'ArrowDown') {
			event.preventDefault()
			const nextIndex = Math.min(filtered.length - 1, currentIndex + 1)
			const nextKey = keyFor(filtered[nextIndex], nextIndex)
			setSelectedKey(nextKey)
			scrollSelectedIntoView(nextKey)
			activateFormula(filtered[nextIndex])
		} else if (event.key === 'ArrowUp') {
			event.preventDefault()
			const prevIndex = Math.max(0, currentIndex - 1)
			const prevKey = keyFor(filtered[prevIndex], prevIndex)
			setSelectedKey(prevKey)
			scrollSelectedIntoView(prevKey)
			activateFormula(filtered[prevIndex])
		} else if (event.key === 'Enter') {
			event.preventDefault()
			activateFormula(filtered[currentIndex], true)
		} else if (event.key.toLowerCase() === 'c') {
			event.preventDefault()
			void copyFormula(filtered[currentIndex], 'latex')
		} else if (event.key.toLowerCase() === 'm') {
			event.preventDefault()
			void copyFormula(filtered[currentIndex], 'mathml')
		} else if (event.key.toLowerCase() === 'u') {
			event.preventDefault()
			void copyFormula(filtered[currentIndex], 'unicodemath')
		}
	}

	if (!formulas.length) {
		return (
			<div className='flex h-full items-center justify-center bg-[linear-gradient(180deg,rgba(255,255,255,0.66),rgba(248,250,252,0.72))]'>
				<div className='rounded-3xl border border-dashed border-[rgba(0,0,0,0.10)] bg-white/60 p-6 text-center text-sm text-[#8e8e96]'>
					<Sigma className='mx-auto mb-2 size-7 text-violet-400' />
					<p className='font-medium'>暂无公式</p>
				</div>
			</div>
		)
	}

	return (
		<div
			ref={listRef}
			tabIndex={0}
			onKeyDown={handleKeyDown}
			className='flex h-full flex-col overflow-hidden bg-[linear-gradient(180deg,rgba(255,255,255,0.64),rgba(248,250,252,0.72))] outline-none'>
			<div className='ios-glass-toolbar sticky top-0 z-10 flex flex-col gap-2 px-4 py-3'>
				<div className='flex items-center justify-between gap-3'>
					<div className='flex items-center gap-2 text-sm font-semibold text-[#0d0d12]'>
						<span className='flex size-8 items-center justify-center rounded-2xl bg-violet-100 text-violet-600'>
							<Sigma className='size-4' />
						</span>
						<div>
							<p>
								{filtered.length}
								<span className='text-[#8e8e96]'> / {formulas.length}</span>
								<span className='ml-1 text-[#8e8e96]'>个公式</span>
							</p>
							<p className='mt-0.5 text-[10px] font-medium text-[#8e8e96]'>
								支持 LaTeX / MathML / PNG 导出
							</p>
						</div>
					</div>
					<ExportMenu taskId={taskId} />
				</div>
				<div className='relative'>
					<Search className='pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-[#8e8e96]' />
					<input
						type='text'
						value={query}
						placeholder='搜索 LaTeX 或 ID'
						onChange={event => setQuery(event.target.value)}
						className='h-9 w-full rounded-full border border-[rgba(0,0,0,0.08)] bg-white/80 pl-9 pr-8 text-[12px] text-[#0d0d12] shadow-inner outline-none transition-colors duration-150 placeholder:text-[#8e8e96] focus-visible:border-blue-400'
					/>
					{query && (
						<button
							type='button'
							aria-label='清空搜索'
							onClick={() => setQuery('')}
							className='absolute right-2 top-1/2 flex size-5 -translate-y-1/2 items-center justify-center rounded-full text-[#8e8e96] hover:bg-[rgba(0,0,0,0.04)] hover:text-[#0d0d12]'>
							<X className='size-3' />
						</button>
					)}
				</div>
			</div>

			<div className='ios-scrollbar flex-1 overflow-auto'>
				{filtered.length === 0 ? (
					<div className='flex h-full items-center justify-center px-6 text-center text-sm text-[#8e8e96]'>
						<p>没有匹配 "{query}" 的公式</p>
					</div>
				) : (
					<div className='space-y-3 p-4'>
						{filtered.map((formula, index) => {
							const cardKey = keyFor(formula, index)
							const isSelected = selectedKey === cardKey
							return (
								<div
									key={cardKey}
									ref={node => {
										if (node) cardRefs.current.set(cardKey, node)
										else cardRefs.current.delete(cardKey)
									}}
									data-selected={isSelected || undefined}
									className={cn(
										'ocr-card-enter group relative rounded-3xl border px-4 py-4 transition-[background-color,border-color,box-shadow,transform] duration-200',
										isSelected
											? 'border-violet-300 bg-white/90 shadow-xl shadow-violet-500/10 ring-1 ring-violet-300/50'
											: 'border-[rgba(0,0,0,0.06)] bg-white/70 shadow-sm hover:-translate-y-0.5 hover:border-blue-200 hover:bg-white/90 hover:shadow-lg'
									)}
									onMouseEnter={() => {
										activateFormula(formula)
										setSelectedKey(cardKey)
									}}
									onMouseLeave={() => setHoveredBlockId(null)}
									onClick={() => {
										setSelectedKey(cardKey)
										activateFormula(formula, true)
									}}>
									<div className='mb-3 flex flex-wrap items-center justify-between gap-2'>
										<div className='flex items-center gap-2'>
											<Badge
												variant='outline'
												className='h-5 rounded-full border-violet-200 bg-violet-50 px-2 text-[10px] font-semibold text-violet-700'>
												P{formula.page_index}
											</Badge>
											<span className='max-w-[9rem] truncate font-mono text-[11px] text-[#8e8e96]'>
												{formula.formula_id}
											</span>
										</div>
										<div className='flex flex-wrap items-center gap-1'>
											{(Object.keys(COPY_LABELS) as CopyFormat[]).map(format => {
												const busyKey = `${formula.formula_id || ''}|${format}`
												const isBusy = copyBusy === busyKey
												const justCopied = copiedKey === busyKey
												return (
													<Button
														key={format}
														variant={justCopied ? 'default' : 'secondary'}
														size='sm'
														disabled={isBusy}
														title={`快捷键 ${COPY_SHORTCUT[format]}`}
														aria-label={`复制 ${COPY_LABELS[format]}`}
														onClick={event => {
															event.stopPropagation()
															void copyFormula(formula, format)
														}}
														className='h-7 gap-1 rounded-full px-2.5 text-[11.5px]'>
														{justCopied ? (
															<Check className='size-3.5' />
														) : isBusy ? (
															<Loader2 className='size-3.5 animate-spin' />
														) : null}
														{COPY_LABELS[format]}
													</Button>
												)
											})}
										</div>
									</div>
									<FormulaPreview latex={formula.latex} />
									<div className='mt-3 flex flex-wrap items-center justify-end gap-1.5'>
										{DOWNLOAD_FORMATS.map(item => {
											const busyKey = `${formula.formula_id || `${formula.page_index}-${formula.block_id ?? 'formula'}`}|${item.format}`
											const isBusy = downloadBusy === busyKey
											const justDownloaded = downloadedKey === busyKey
											return (
												<Button
													key={item.format}
													variant='outline'
													size='sm'
													disabled={isBusy}
													aria-label={`下载 ${item.label}`}
													onClick={event => {
														event.stopPropagation()
														void downloadFormula(formula, item.format)
													}}
													className='h-7 gap-1 rounded-full border-[rgba(0,0,0,0.08)] bg-white/80 px-2.5 text-[11px] font-semibold text-[#54545c] shadow-sm hover:bg-white'>
													{justDownloaded ? (
														<Check className='size-3.5 text-emerald-600' />
													) : isBusy ? (
														<Loader2 className='size-3.5 animate-spin' />
													) : (
														<Download className='size-3.5' />
													)}
													{item.label}
												</Button>
											)
										})}
									</div>
								</div>
							)
						})}
					</div>
				)}
			</div>
		</div>
	)
}
