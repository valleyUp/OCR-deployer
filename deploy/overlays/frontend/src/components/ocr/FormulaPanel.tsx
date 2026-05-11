import katex from 'katex'
import 'katex/dist/katex.min.css'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Copy, FileArchive, Loader2, Sigma } from 'lucide-react'
import { cn } from '@/libs/utils'
import { exportTaskFormulas, renderFormulaText, type FormulaItem } from '@/libs/api'
import { type Block, useOcrStore } from '@/store/useOcrStore'
import { useLinkState, useLinkStore } from '@/hooks/useLinkState'
import { toast } from 'sonner'

interface FormulaPanelProps { formulas: FormulaItem[]; taskId?: string | number; searchQuery?: string }

type CopyFormat = 'latex' | 'mathml' | 'unicodemath'
const COPY_MAP: Record<CopyFormat, string> = { latex: 'LaTeX', mathml: 'MathML', unicodemath: 'UnicodeMath' }
const COPY_SUCCESS: Record<CopyFormat, string> = { latex: 'LaTeX copied', mathml: 'MathML copied', unicodemath: 'UnicodeMath copied' }

function FormulaPreview({ latex }: { latex: string }) {
  const html = useMemo(() => katex.renderToString(latex || '', { displayMode: true, throwOnError: false, strict: false, output: 'html' }), [latex])
  return <div className='formula-card-body' dangerouslySetInnerHTML={{ __html: html }} />
}

function resolveFormulaBlock(formula: FormulaItem, blocks: Block[]) {
  const blockId = Number(formula.block_id)
  return blocks.find(b =>
    b.formulaId === formula.formula_id ||
    (!Number.isNaN(blockId) && b.id === blockId)
  ) ?? null
}

export function FormulaPanel({ formulas, taskId, searchQuery = '' }: FormulaPanelProps) {
  const listRef = useRef<HTMLDivElement>(null)
  const blocks = useOcrStore(s => s.blocks)
  const setHoveredBlockId = useOcrStore(s => s.setHoveredBlockId)
  const setClickedBlockId = useOcrStore(s => s.setClickedBlockId)
  const { triggerLink, isActive } = useLinkState()
  const activeLinkId = useLinkStore(s => s.activeBlockId)
  const linkSource = useLinkStore(s => s.source)
  const linkEventId = useLinkStore(s => s.eventId)
  const [copyBusy, setCopyBusy] = useState<string | null>(null)
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const [exportBusy, setExportBusy] = useState(false)

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return formulas
    return formulas.filter(f => (f.latex || '').toLowerCase().includes(q) || (f.formula_id || '').toLowerCase().includes(q))
  }, [searchQuery, formulas])

  const keyFor = (f: FormulaItem, i: number) => f.formula_id || `${f.page_index}-${i}`

  useEffect(() => {
    if (!activeLinkId || linkSource !== 'preview') return
    const el = listRef.current?.querySelector(`[data-block-id="${activeLinkId}"]`)
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    el.classList.add('link-highlight')
    const t = setTimeout(() => el.classList.remove('link-highlight'), 2400)
    return () => { clearTimeout(t); el.classList.remove('link-highlight') }
  }, [activeLinkId, linkSource, linkEventId])

  const copyFormula = useCallback(async (formula: FormulaItem, format: CopyFormat) => {
    const ck = formula.formula_id || ''; const bk = `${ck}|${format}`
    setCopyBusy(bk)
    try {
      const text = await renderFormulaText(formula.latex, format)
      await navigator.clipboard.writeText(text)
      toast.success(COPY_SUCCESS[format]); setCopiedKey(bk)
      setTimeout(() => setCopiedKey(p => p === bk ? null : p), 1200)
    } catch (e: any) { toast.error(`Copy failed: ${e.message}`) }
    finally { setCopyBusy(null) }
  }, [])

  const handleExport = async () => {
    if (!taskId) return; setExportBusy(true)
    try {
      const blob = await exportTaskFormulas(taskId, ['latex', 'mathml', 'unicodemath', 'png'])
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${taskId}-formulas.zip`; a.click()
      toast.success('Export started')
    } catch (e: any) { toast.error(`Export failed: ${e.message}`) }
    finally { setExportBusy(false) }
  }

  if (!formulas.length) {
    return (
      <div className='empty-state'>
        <div className='empty-state-icon'><Sigma size={36} /></div>
        <p className='empty-state-title'>No formulas</p>
        <p className='empty-state-desc'>Formulas detected during OCR will appear here</p>
      </div>
    )
  }

  return (
    <div className='flex flex-col gap-2' ref={listRef}>
      {/* Toolbar */}
      <div className='flex items-center justify-between mb-1'>
        <span className='text-xs text-[var(--color-text-muted)]'>
          {filtered.length} / {formulas.length} formulas
        </span>
        <button className='btn btn-outline' style={{ height: 28, fontSize: 11 }} disabled={exportBusy || !taskId} onClick={handleExport}>
          {exportBusy ? <Loader2 size={12} className='animate-spin' /> : <FileArchive size={12} />}
          Export ZIP
        </button>
      </div>

      {filtered.length === 0 ? (
        <p className='text-xs text-[var(--color-text-muted)] text-center py-8'>No results for &ldquo;{searchQuery}&rdquo;</p>
      ) : (
        filtered.map((formula, i) => {
          const ck = keyFor(formula, i)
          const block = resolveFormulaBlock(formula, blocks)
          const bId = String(block?.id ?? formula.block_id ?? i)
          const active = isActive(bId)
          return (
            <div key={ck} data-block-id={bId} className={cn('formula-card', active && 'active')}
              onMouseEnter={() => { if (block) setHoveredBlockId(block.id) }}
              onMouseLeave={() => setHoveredBlockId(null)}
              onClick={() => {
                if (block) setClickedBlockId(block.id)
                triggerLink(bId, 'result')
              }}>
              <div className='formula-card-header'>
                <span className='formula-card-id'>{formula.formula_id}</span>
                <div className='formula-card-actions'>
                  {(Object.keys(COPY_MAP) as CopyFormat[]).map(fmt => {
                    const bk = `${formula.formula_id || ''}|${fmt}`
                    return (
                      <button key={fmt} className='formula-copy-btn' disabled={copyBusy === bk}
                        onClick={e => { e.stopPropagation(); void copyFormula(formula, fmt) }} title={`Copy ${COPY_MAP[fmt]}`}>
                        {copiedKey === bk ? <span className='text-[var(--color-success)]'>Copied</span> : copyBusy === bk ? <Loader2 size={10} className='animate-spin' /> : <><Copy size={10} /> {COPY_MAP[fmt]}</>}
                      </button>
                    )
                  })}
                </div>
              </div>
              <FormulaPreview latex={formula.latex} />
            </div>
          )
        })
      )}
    </div>
  )
}
