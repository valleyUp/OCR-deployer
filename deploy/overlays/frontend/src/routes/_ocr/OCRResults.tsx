import { useEffect, useMemo, useRef, useState } from 'react'
import type { TaskResponse } from './FileUpload'
import { MarkdownPreview } from '@/components/ocr/MarkdownPreview'
import { useOcrStore } from '../../store/useOcrStore'
import { useLinkStore } from '@/hooks/useLinkState'
import { DownloadIcon, FileTextIcon, Hash, Layers, Search, Sigma, Timer, X } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from 'sonner'
import { JsonPreview } from '@/components/ocr/JsonPreview'
import { FormulaPanel } from '@/components/ocr/FormulaPanel'
import type { FormulaItem } from '@/libs/api'

interface OCRResultsProps { result: TaskResponse | null; fileName?: string }
type ResultTab = 'markdown' | 'json' | 'formulas'

export function OCRResults({ result, fileName }: OCRResultsProps) {
  const setBlocks = useOcrStore(s => s.setBlocks)
  const activeLinkId = useLinkStore(s => s.activeBlockId)
  const [activeTab, setActiveTab] = useState<ResultTab>('markdown')
  const [searchQuery, setSearchQuery] = useState('')
  const autoSwitchedRef = useRef(false)
  const autoSwitchTaskRef = useRef<string | number | null>(null)

  const layout = useMemo(() => result?.response?.layout || [], [result])
  const pageHeight = result?.response?.metadata?.height ?? 2339
  const images = useMemo(() => result?.response?.images || {}, [result?.response?.images])

  const formulas = useMemo<FormulaItem[]>(() => {
    const rf = result?.response?.formulas
    if (rf?.length) return rf
    return layout.filter((b: any) => b.formula?.latex || String(b.layout_type || '').toLowerCase().includes('formula'))
      .map((b: any, i: number) => ({
        formula_id: b.formula_id || `f-p${b.page_index ?? 1}-b${b.block_id ?? i + 1}`,
        task_id: result?.response?.task_id, block_id: b.block_id, page_index: b.page_index ?? 1,
        bbox: b.bbox ?? null, layout_type: b.layout_type,
        latex: b.formula?.latex || String(b.block_content || '').replace(/^\$\$|\\\[|\\\(|\$\$$|\\\]|\\\)$/g, '').trim(),
        formula: b.formula
      }))
  }, [layout, result?.response?.formulas, result?.response?.task_id])

  const blocks = useMemo(() => {
    if (result?.status !== 'completed') return []
    return layout.filter((b: any) => b.block_content?.trim()).map((b: any, i: number) => {
      const [x1, y1, x2, y2] = (b.bbox as [number, number, number, number]) || [0, 0, 0, 0]
      return {
        id: b.block_id ?? i, content: (b.block_content || '').trim(),
        bbox: b.bbox ? [x1, y1, x2, y2] as [number, number, number, number] : null,
        pageIndex: b.page_index ?? 1, isImage: (b.block_content || '').startsWith('!['),
        layoutType: b.layout_type, formulaId: b.formula_id, latex: b.formula?.latex,
        width: x2 - x1, height: y2 - y1
      }
    })
  }, [layout, images, pageHeight, result?.status])

  useEffect(() => { if (result?.status === 'completed') setBlocks(blocks) }, [blocks, result?.status, setBlocks])

  // Auto-switch to formulas tab
  useEffect(() => {
    const tid = result?.response?.task_id
    if (tid && autoSwitchTaskRef.current !== tid) { autoSwitchTaskRef.current = tid; autoSwitchedRef.current = false }
    const pm = result?.response?.processing_mode || result?.response?.metadata?.processing_mode
    if (!autoSwitchedRef.current && result?.status === 'completed' && pm === 'formula') { setActiveTab('formulas'); autoSwitchedRef.current = true }
    else if (!autoSwitchedRef.current && result?.status === 'completed' && pm && pm !== 'formula' && activeTab === 'formulas') { setActiveTab('markdown'); autoSwitchedRef.current = true }
  }, [activeTab, result?.status, result?.response?.task_id, result?.response?.processing_mode, result?.response?.metadata?.processing_mode])

  // Click from preview → switch to matching result tab
  const clickedPdfBlockId = useOcrStore(s => s.clickedPdfBlockId)
  useEffect(() => {
    if (clickedPdfBlockId === null) return
    const block = blocks.find(b => b.id === clickedPdfBlockId)
    if (block?.formulaId || block?.layoutType?.includes('formula') || block?.latex) setActiveTab('formulas')
  }, [clickedPdfBlockId, blocks])

  // Scroll result to linked block + highlight pulse
  useEffect(() => {
    if (!activeLinkId) return
    const el = document.querySelector(`.result-content [data-block-id="${activeLinkId}"]`)
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    el.classList.add('link-highlight')
    const t = setTimeout(() => el.classList.remove('link-highlight'), 2600)
    return () => { clearTimeout(t); el.classList.remove('link-highlight') }
  }, [activeLinkId])

  const handleDownload = () => {
    if (!result?.response?.full_markdown) return
    const blob = new Blob([result.response.full_markdown], { type: 'text/markdown' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${fileName || 'result'}.md`; a.click()
    toast.success('Download started')
  }

  const response = result?.response; const status = result?.status; const errorMessage = result?.error_message
  const metadata = response?.metadata
  const totalPages = metadata?.total_pages ?? layout.reduce((max: number, b: any) => Math.max(max, b.page_index ?? 1), 0)
  const execSec = response?.execution_time ?? response?.result?.execution_time
  const processingMode = response?.processing_mode || metadata?.processing_mode || 'pipeline'

  if (!status) {
    return (
      <div className='flex h-full flex-col'>
        <div className='empty-state'>
          <div className='empty-state-icon'><FileTextIcon size={40} /></div>
          <p className='empty-state-title'>No result yet</p>
          <p className='empty-state-desc'>Upload a file to see recognition output</p>
        </div>
      </div>
    )
  }

  return (
    <div className='flex h-full flex-col'>
      {/* Header */}
      <div className='result-header'>
        <div className='flex items-baseline'>
          <span className='result-title'>Result</span>
          <span className='result-subtitle'>{processingMode === 'formula' ? 'formula' : 'layout'}</span>
        </div>
        {status === 'completed' && (
          <button className='btn btn-outline' style={{ height: 28, fontSize: 12 }} onClick={handleDownload}>
            <DownloadIcon size={14} /> Export
          </button>
        )}
      </div>

      {/* Stat bar */}
      {status === 'completed' && (
        <div className='stat-bar'>
          <span className='stat-item'><Layers size={12} /><strong>{totalPages}</strong><span>p</span></span>
          <span className='stat-sep' />
          <span className='stat-item'><Hash size={12} /><strong>{layout.length}</strong><span>blocks</span></span>
          <span className='stat-sep' />
          <span className='stat-item'><Sigma size={12} /><strong>{formulas.length}</strong><span>formulas</span></span>
          {execSec && <><span className='stat-sep' /><span className='stat-item'><Timer size={12} /><strong>{execSec.toFixed(1)}</strong><span>s</span></span></>}
        </div>
      )}

      {/* Search */}
      <div className='result-search'>
        <Search size={14} className='text-[var(--color-text-muted)]' />
        <input type='text' value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder='Search across results...'
          className='result-search-input' />
        {searchQuery && <button onClick={() => setSearchQuery('')} className='text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]'><X size={14} /></button>}
      </div>

      {/* Tab bar */}
      <div className='tab-bar'>
        <button className='tab-bar-btn' aria-selected={activeTab === 'markdown'} onClick={() => setActiveTab('markdown')}>Markdown</button>
        <button className='tab-bar-btn' aria-selected={activeTab === 'json'} onClick={() => setActiveTab('json')}>JSON</button>
        <button className='tab-bar-btn' aria-selected={activeTab === 'formulas'} onClick={() => setActiveTab('formulas')}>Formulas</button>
      </div>

      {/* Content */}
      <div className='result-content'>
        {activeTab === 'markdown' && (
          status === 'completed' ? (blocks.length > 0 ? <MarkdownPreview /> : <p className='text-sm text-[var(--color-text-muted)] text-center py-12'>No markdown content</p>)
            : status === 'failed' ? <p className='text-sm text-[var(--color-error)] text-center py-12'>{errorMessage || 'Recognition failed'}</p>
            : <div className='space-y-3'><Skeleton className='h-4 w-3/4 rounded skeleton' /><Skeleton className='h-4 w-full rounded skeleton' /><Skeleton className='h-4 w-1/2 rounded skeleton' /></div>
        )}
        {activeTab === 'json' && (
          <div className='json-block'>{response && status === 'completed' ? <JsonPreview json={response} /> : status === 'pending' || status === 'processing' ? <Skeleton className='h-4 w-3/4 skeleton' /> : <p className='text-[var(--color-text-muted)]'>No data</p>}</div>
        )}
        {activeTab === 'formulas' && (
          <FormulaPanel formulas={formulas} taskId={response?.task_id} searchQuery={searchQuery} />
        )}
      </div>
    </div>
  )
}
