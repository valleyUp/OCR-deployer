import katex from 'katex'
import 'katex/dist/katex.min.css'
import { CopyIcon, FileArchiveIcon, FileCodeIcon, ImageIcon, Sigma } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { exportTaskFormulas, renderFormula, type FormulaItem } from '@/libs/api'
import { useOcrStore } from '@/store/useOcrStore'
import { toast } from 'sonner'

interface FormulaPanelProps {
	formulas: FormulaItem[]
	taskId?: string | number
}

const formatLabels: Record<'latex' | 'mathml' | 'png', string> = {
	latex: 'TeX',
	mathml: 'MML',
	png: 'PNG'
}

function formulaFileName(formula: FormulaItem, extension: string) {
	return `${formula.formula_id || 'formula'}.${extension}`
}

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
			className='overflow-auto rounded-md border bg-white px-3 py-2'
			dangerouslySetInnerHTML={{ __html: markup }}
		/>
	)
}

export function FormulaPanel({ formulas, taskId }: FormulaPanelProps) {
	const blocks = useOcrStore(s => s.blocks)
	const setHoveredBlockId = useOcrStore(s => s.setHoveredBlockId)
	const setClickedBlockId = useOcrStore(s => s.setClickedBlockId)

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

	const copyLatex = async (latex: string) => {
		await navigator.clipboard.writeText(latex)
		toast.success('LaTeX 已复制')
	}

	const downloadFormula = async (formula: FormulaItem, format: 'latex' | 'mathml' | 'png') => {
		const blob = await renderFormula(formula.latex, format)
		const extension = format === 'latex' ? 'tex' : format === 'mathml' ? 'mml' : 'png'
		saveBlob(blob, formulaFileName(formula, extension))
	}

	const downloadAll = async () => {
		if (!taskId) return
		const blob = await exportTaskFormulas(taskId, ['latex', 'mathml', 'png'])
		saveBlob(blob, `${taskId}-formulas.zip`)
	}

	if (!formulas.length) {
		return (
			<div className='h-full flex items-center justify-center'>
				<div className='p-4 rounded-lg text-center text-gray-500 dark:text-gray-400'>
					<p>暂无公式</p>
				</div>
			</div>
		)
	}

	return (
		<div className='h-full overflow-auto bg-gray-50'>
			<div className='sticky top-0 z-10 flex items-center justify-between border-b bg-white px-4 py-3'>
				<div className='flex items-center gap-2 text-sm font-medium'>
					<Sigma className='size-4' />
					<span>{formulas.length} 个公式</span>
				</div>
				<Button variant='outline' size='sm' onClick={downloadAll} disabled={!taskId}>
					<FileArchiveIcon className='size-4' />
					批量导出
				</Button>
			</div>

			<div className='divide-y'>
				{formulas.map((formula, index) => (
					<div
						key={formula.formula_id || `${formula.page_index}-${index}`}
						className='bg-white px-4 py-4 hover:bg-gray-50'
						onMouseEnter={() => activateFormula(formula)}
						onMouseLeave={() => setHoveredBlockId(null)}
						onClick={() => activateFormula(formula, true)}>
						<div className='mb-3 flex items-center justify-between gap-3'>
							<div className='flex items-center gap-2'>
								<Badge variant='outline'>P{formula.page_index}</Badge>
								<span className='text-xs text-gray-500'>{formula.formula_id}</span>
							</div>
							<div className='flex items-center gap-1'>
								<Button
									variant='ghost'
									size='icon-sm'
									title='复制 LaTeX'
									onClick={event => {
										event.stopPropagation()
										void copyLatex(formula.latex)
									}}>
									<CopyIcon className='size-4' />
								</Button>
								<Button
									variant='ghost'
									size='icon-sm'
									title='下载 LaTeX'
									onClick={event => {
										event.stopPropagation()
										void downloadFormula(formula, 'latex')
									}}>
									<FileCodeIcon className='size-4' />
								</Button>
								<Button
									variant='ghost'
									size='icon-sm'
									title='下载 MathML'
									onClick={event => {
										event.stopPropagation()
										void downloadFormula(formula, 'mathml')
									}}>
									<span className='text-[11px] font-semibold'>{formatLabels.mathml}</span>
								</Button>
								<Button
									variant='ghost'
									size='icon-sm'
									title='下载 PNG'
									onClick={event => {
										event.stopPropagation()
										void downloadFormula(formula, 'png')
									}}>
									<ImageIcon className='size-4' />
								</Button>
							</div>
						</div>
						<FormulaPreview latex={formula.latex} />
						<pre className='mt-3 overflow-auto rounded-md bg-gray-950 p-3 text-xs leading-5 text-gray-100'>
							{formula.latex}
						</pre>
					</div>
				))}
			</div>
		</div>
	)
}
