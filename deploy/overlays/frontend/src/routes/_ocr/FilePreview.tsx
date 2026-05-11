import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { ArrowRight, FileText, LocateFixed, Maximize2, Minus, Plus, RotateCw } from 'lucide-react'
import type { TaskResponse, UploadedFile } from './FileUpload'
import { useOcrStore } from '../../store/useOcrStore'
import { useLinkStore } from '@/hooks/useLinkState'
import PdfViewer from '@/components/ocr/PdfViewer'
import { usePdfPageMetrics } from '@/hooks/usePdfPageMetrics'
import { useFileBlockInteraction } from '@/hooks/useFileBlockInteraction'
import { usePdfScrollToBlock } from '@/hooks/usePdfScrollToBlock'
import { Button } from '@/components/ui/button'
import { cn } from '@/libs/utils'
import { useLinkState } from '@/hooks/useLinkState'

interface FilePreviewProps { file: UploadedFile | null; result: TaskResponse | null }

const ZOOM_MIN = 0.25; const ZOOM_MAX = 4; const ZOOM_STEP = 0.25

export function FilePreview({ file, result }: FilePreviewProps) {
  const [pdfUrl, setPdfUrl] = useState<string | null>(null)
  const viewerRef = useRef<HTMLDivElement>(null)
  const imageRef = useRef<HTMLImageElement>(null)
  const hoveredBlockId = useOcrStore(s => s.hoveredBlockId)
  const clickedBlockId = useOcrStore(s => s.clickedBlockId)
  const setHoveredBlockId = useOcrStore(s => s.setHoveredBlockId)
  const setClickedPdfBlockId = useOcrStore(s => s.setClickedPdfBlockId)
  const clickedPdfBlockId = useOcrStore(s => s.clickedPdfBlockId)
  const blocks = useOcrStore(s => s.blocks)
  const activeLinkId = useLinkStore(s => s.activeBlockId)
  const linkSource = useLinkStore(s => s.source)
  const linkEventId = useLinkStore(s => s.eventId)
  const { triggerLink } = useLinkState()
  const [_showCopy, setShowCopy] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [rotation, setRotation] = useState(0)

  const lower = file?.name.toLowerCase() ?? ''
  const isPdf = Boolean(file && (file.type === 'application/pdf' || lower.endsWith('.pdf')))
  const isImg = Boolean(file && (file.type.startsWith('image/') || /\.(png|jpe?g|webp|bmp|gif)$/i.test(lower)))
  const pw = result?.response?.metadata?.width ?? 1654
  const ph = result?.response?.metadata?.height ?? 2339
  const isValid = useMemo(() => !isNaN(pw) && !isNaN(ph) && result?.status === 'completed', [pw, ph, result?.status])

  const hoveredBlock = hoveredBlockId !== null ? blocks.find(b => b.id === hoveredBlockId) : null
  const clickedBlock = clickedBlockId !== null ? blocks.find(b => b.id === clickedBlockId) : null
  const clickedPdfBlock = clickedPdfBlockId !== null ? blocks.find(b => b.id === clickedPdfBlockId) : null
  const linkedBlock = activeLinkId ? blocks.find(b => String(b.id) === activeLinkId) : null
  const activeBlock = clickedBlock || clickedPdfBlock || linkedBlock || hoveredBlock || null

  const [_imageScale, setImageScale] = useState({ x: 1, y: 1, offsetX: 0, offsetY: 0 })

  useEffect(() => {
    if (!imageRef.current || isPdf) return
    const update = () => {
      const img = imageRef.current; if (!img) return
      const ir = img.getBoundingClientRect(); const cr = img.parentElement?.getBoundingClientRect(); if (!cr) return
      setImageScale({ x: ir.width / img.naturalWidth, y: ir.height / img.naturalHeight, offsetX: ir.left - cr.left, offsetY: ir.top - cr.top })
    }
    const img = imageRef.current
    if (img.complete) update(); else img.addEventListener('load', update)
    window.addEventListener('resize', update); return () => { img.removeEventListener('load', update); window.removeEventListener('resize', update) }
  }, [pdfUrl, isPdf, zoom, rotation])

  const pdfPageMetrics = usePdfPageMetrics(viewerRef as RefObject<HTMLDivElement>, pdfUrl, isPdf ? 'application/pdf' : file?.type, isValid, activeBlock, pw, ph)
  const setPreviewClickedBlockId = useCallback((blockId: number | null) => {
    setClickedPdfBlockId(blockId)
    if (blockId !== null) triggerLink(String(blockId), 'preview')
  }, [setClickedPdfBlockId, triggerLink])
  const { handlePdfClick, handlePdfMouseMove, handlePdfMouseLeave, handleImageClick, handleImageMouseMove, handleImageMouseLeave } = useFileBlockInteraction({ blocks, resultStatus: result?.status, setHoveredBlockId, setClickedBlockId: setPreviewClickedBlockId, setShowCopyButton: setShowCopy })
  usePdfScrollToBlock(clickedBlockId, clickedBlock ?? null, viewerRef as RefObject<HTMLDivElement>, pw, ph, result?.status)

  useEffect(() => { if (!hoveredBlockId && !clickedBlockId) setShowCopy(false) }, [hoveredBlockId, clickedBlockId])
  useEffect(() => {
    if (file && (isPdf || isImg)) { const url = URL.createObjectURL(file.file); setPdfUrl(url); setZoom(1); setRotation(0); return () => URL.revokeObjectURL(url) }
    setPdfUrl(null)
  }, [file, isPdf, isImg])

  // Link state: scroll preview to linked block + highlight pulse
  useEffect(() => {
    if (!activeLinkId || linkSource !== 'result' || !viewerRef.current) return
    const el = viewerRef.current.querySelector(`[data-block-id="${activeLinkId}"]`)
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    el.classList.add('active')
    const t = setTimeout(() => el.classList.remove('active'), 2600)
    return () => { clearTimeout(t); el.classList.remove('active') }
  }, [activeLinkId, linkSource, linkEventId])

  const renderOverlay = (pageNumber: number) => {
    if (!activeBlock?.bbox) return null
    if (activeBlock.pageIndex !== pageNumber) return null
    const m = pdfPageMetrics[pageNumber]; if (!m) return null
    const sx = m.width / pw; const sy = m.height / ph
    return (
      <div
        data-block-id={String(activeBlock.id)}
        className={cn('block-hotzone', activeLinkId === String(activeBlock.id) && 'active')}
        style={{ left: m.offsetX + activeBlock.bbox[0] * sx, top: m.offsetY + activeBlock.bbox[1] * sy, width: activeBlock.width * sx, height: activeBlock.height * sy }}>
        <span className='block-hotzone-icon'><ArrowRight size={12} /></span>
      </div>
    )
  }

  if (!file) {
    return (
      <div className='workspace'>
        <div className='preview-toolbar'>
          <span className='preview-breadcrumb'><span style={{ color: 'var(--color-text-muted)' }}>No file</span></span>
        </div>
        <div className='empty-state'>
          <div className='empty-state-icon'><FileText size={40} /></div>
          <p className='empty-state-title'>Drop a file to begin</p>
          <p className='empty-state-desc'>Upload a PDF or image to start OCR recognition</p>
        </div>
      </div>
    )
  }

  const imgToolbar = isImg ? (
    <div className='pointer-events-auto absolute right-4 top-4 z-20 flex items-center gap-1 rounded-full border border-[var(--color-border)] bg-white/85 px-1 py-1 shadow-sm backdrop-blur-xl'>
      <Button variant='ghost' size='icon-sm' className='btn-ghost size-8' disabled={zoom <= ZOOM_MIN + 1e-6} onClick={() => setZoom(z => Math.max(ZOOM_MIN, Math.round((z - ZOOM_STEP) * 100) / 100))}><Minus size={16} /></Button>
      <span className='min-w-[3.25rem] text-center text-[11px] tabular-nums text-[var(--color-text-secondary)]'>{Math.round(zoom * 100)}%</span>
      <Button variant='ghost' size='icon-sm' className='btn-ghost size-8' disabled={zoom >= ZOOM_MAX - 1e-6} onClick={() => setZoom(z => Math.min(ZOOM_MAX, Math.round((z + ZOOM_STEP) * 100) / 100))}><Plus size={16} /></Button>
      <span className='mx-1 h-4 w-px bg-[var(--color-border)]' />
      <Button variant='ghost' size='icon-sm' className='btn-ghost size-8' onClick={() => { setZoom(1); setRotation(0) }}><Maximize2 size={16} /></Button>
      <Button variant='ghost' size='icon-sm' className='btn-ghost size-8' onClick={() => setRotation(r => (r + 90) % 360)}><RotateCw size={16} /></Button>
    </div>
  ) : null

  return (
    <div className='workspace'>
      <div className='preview-toolbar'>
        <div className='preview-breadcrumb'>
          <span>task /</span> <strong>{file.name}</strong>
        </div>
        <div className='preview-badges'>
          <span className='preview-badge'><LocateFixed size={12} />{activeBlock?.layoutType || 'preview'}</span>
          <span className='preview-badge' style={{ color: result?.status === 'completed' ? 'var(--color-success)' : result?.status === 'failed' ? 'var(--color-error)' : 'var(--color-text-secondary)' }}>
            {result?.status === 'completed' ? 'done' : result?.status === 'failed' ? 'failed' : result?.status === 'processing' ? 'processing' : 'idle'}
          </span>
        </div>
      </div>

      <div className='preview-container' ref={viewerRef}>
        <div className='preview-canvas' style={{ position: 'relative', minHeight: isPdf ? 'auto' : 400 }}>
          {imgToolbar}
          {isPdf ? (
            <PdfViewer file={file.file} className='h-full' renderPageOverlay={renderOverlay}
              onPageClick={(e, pn) => handlePdfClick(e, pn, pw, ph)} onPageMouseMove={(e, pn) => handlePdfMouseMove(e, pn, pw, ph)} onPageMouseLeave={handlePdfMouseLeave} />
          ) : isImg && pdfUrl ? (
            <div className={cn('relative flex cursor-pointer items-center justify-center overflow-auto p-6', zoom > 1 && 'cursor-grab')}
              onClick={handleImageClick} onMouseMove={handleImageMouseMove} onMouseLeave={handleImageMouseLeave}>
              <img ref={imageRef} src={pdfUrl} alt={file.name}
                className='max-h-full max-w-full rounded object-contain shadow-md transition-transform duration-200 ease-out'
                style={{ transform: `scale(${zoom}) rotate(${rotation}deg)`, transformOrigin: 'center center' }} />
            </div>
          ) : (
            <div className='flex h-full items-center justify-center text-sm text-[var(--color-text-muted)]'>Unsupported format</div>
          )}
        </div>
      </div>
    </div>
  )
}
