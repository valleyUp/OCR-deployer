/**
 * SVG bezier connection line between preview and result blocks during bidirectional navigation.
 * Renders as a fixed overlay, fades in and out.
 */
import { useEffect, useState } from 'react'
import { useLinkStore } from '@/hooks/useLinkState'

function blockSelector(blockId: string) {
  const escaped = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(blockId) : blockId.replace(/"/g, '\\"')
  return `[data-block-id="${escaped}"]`
}

export function LinkBridge() {
  const activeBlockId = useLinkStore(s => s.activeBlockId)
  const linkEventId = useLinkStore(s => s.eventId)
  const [path, setPath] = useState<string | null>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (!activeBlockId) { setVisible(false); return }

    let hideTimer: ReturnType<typeof setTimeout> | null = null
    const drawTimer = setTimeout(() => {
      const selector = blockSelector(activeBlockId)
      const previewEl = document.querySelector(`.preview-container ${selector}`)
      const resultEl = document.querySelector(`.result-content ${selector}`)
      if (!previewEl || !resultEl) return

      const previewRect = previewEl.getBoundingClientRect()
      const resultRect = resultEl.getBoundingClientRect()

      const x1 = previewRect.right
      const y1 = previewRect.top + previewRect.height / 2
      const x2 = resultRect.left
      const y2 = resultRect.top + resultRect.height / 2
      const dx = Math.max(80, Math.abs(x2 - x1) * 0.4)

      setPath(`M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`)
      setVisible(true)
      hideTimer = setTimeout(() => setVisible(false), 650)
    }, 120)

    return () => {
      clearTimeout(drawTimer)
      if (hideTimer) clearTimeout(hideTimer)
    }
  }, [activeBlockId, linkEventId])

  if (!visible || !path) return null

  return (
    <svg className='link-bridge-svg' aria-hidden='true'>
      <path d={path} className='link-bridge-path' />
    </svg>
  )
}
