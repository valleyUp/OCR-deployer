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
			className='overflow-auto rounded-md border border-zinc-200 bg-white px-3 py-3 text-zinc-900'
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
					className='absolute right-0 z-20 mt-1 w-56 overflow-hidden rounded-lg border border-border bg-white shadow-lg motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-95 motion-safe:duration-150 origin-top-right'>
					{EXPORT_PRESETS.map(preset => {
						const isBusy = busyKey === preset.key
						return (
							<button
								key={preset.key}
								type='button'
								role='menuitem'
								disabled={busyKey !== null}
								onClick={() => void runExport(preset)}
								className='flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm text-zinc-700 transition-colors duration-150 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60'>
								<span className='flex items-center gap-2'>
									{isBusy && <Loader2 className='size-3.5 animate-spin text-primary' />}
									<span className={cn(isBusy && 'text-muted-foreground')}>
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
	const [copiedKey, setCopiedKey] = useState<string | null>(null)
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

	const scrollSelectedIntoView = (key: string | null) => {
		if (!key) return
		const node = cardRefs.current.get(key)
		node?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
	}

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
			<div className='flex h-full items-center justify-center bg-zinc-50'>
				<div className='rounded-lg p-4 text-center text-sm text-muted-foreground'>
					<Sigma className='mx-auto mb-2 size-6 text-muted-foreground/60' />
					<p>暂无公式</p>
				</div>
			</div>
		)
	}

	return (
		<div
			ref={listRef}
			tabIndex={0}
			onKeyDown={handleKeyDown}
			className='flex h-full flex-col overflow-hidden bg-zinc-50 outline-none'>
			<div className='sticky top-0 z-10 flex flex-col gap-2 border-b border-border bg-white/95 px-4 py-3 backdrop-blur-sm'>
				<div className='flex items-center justify-between gap-3'>
					<div className='flex items-center gap-2 text-sm font-medium text-foreground'>
						<Sigma className='size-4' />
						<span>
							{filtered.length}
							<span className='text-muted-foreground'> / {formulas.length}</span>
							<span className='ml-1 text-muted-foreground'>个公式</span>
						</span>
					</div>
					<ExportMenu taskId={taskId} />
				</div>
				<div className='relative'>
					<Search className='pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground' />
					<input
						type='text'
						value={query}
						placeholder='搜索 LaTeX 或 ID'
						onChange={event => setQuery(event.target.value)}
						className='h-8 w-full rounded-full border border-border bg-white pl-8 pr-8 text-[12px] text-foreground outline-none transition-colors duration-150 placeholder:text-muted-foreground focus-visible:border-primary/60'
					/>
					{query && (
						<button
							type='button'
							aria-label='清空搜索'
							onClick={() => setQuery('')}
							className='absolute right-2 top-1/2 flex size-5 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground hover:bg-zinc-100 hover:text-foreground'>
							<X className='size-3' />
						</button>
					)}
				</div>
			</div>

			<div className='flex-1 overflow-auto'>
				{filtered.length === 0 ? (
					<div className='flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground'>
						<p>没有匹配 "{query}" 的公式</p>
					</div>
				) : (
					<div className='divide-y divide-zinc-200'>
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
										'group relative px-4 py-4 transition-colors duration-150 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-1 motion-safe:duration-200',
										isSelected
											? 'bg-primary/5 ring-1 ring-inset ring-primary/40'
											: 'bg-white hover:bg-zinc-50'
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
												className='h-5 rounded-full px-2 text-[10px]'>
												P{formula.page_index}
											</Badge>
											<span className='font-mono text-[11px] text-muted-foreground'>
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
														className='h-7 gap-1 px-2.5 text-[11.5px]'>
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
								</div>
							)
						})}
					</div>
				)}
			</div>
		</div>
	)
}
