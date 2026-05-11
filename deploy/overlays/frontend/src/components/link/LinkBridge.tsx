/**
 * SVG bezier connection line between preview and result blocks during bidirectional navigation.
 * Renders as a fixed overlay, fades in and out.
 */
import { useEffect, useState } from 'react'
import { useLinkStore } from '@/hooks/useLinkState'

export function LinkBridge() {
  const activeBlockId = useLinkStore(s => s.activeBlockId)
  const [path, setPath] = useState<string | null>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (!activeBlockId) { setVisible(false); return }

    // Find the two linked elements by data-block-id
    const fromEl = document.querySelector(`[data-block-id="${activeBlockId}"]`)
    if (!fromEl) return

    // Look for the partner element (same blockId, in the other panel)
    const all = document.querySelectorAll(`[data-block-id="${activeBlockId}"]`)
    if (all.length < 2) return

    const toEl = all[0] === fromEl ? all[1] : all[0]

    const fromRect = fromEl.getBoundingClientRect()
    const toRect = toEl.getBoundingClientRect()

    const x1 = fromRect.left + fromRect.width / 2
    const y1 = fromRect.top + fromRect.height / 2
    const x2 = toRect.left + toRect.width / 2
    const y2 = toRect.top + toRect.height / 2

    const cx1 = x1 + (x2 - x1) * 0.35
    const cy1 = y1
    const cx2 = x1 + (x2 - x1) * 0.65
    const cy2 = y2

    setPath(`M${x1},${y1} C${cx1},${cy1} ${cx2},${cy2} ${x2},${y2}`)
    setVisible(true)

    const timer = setTimeout(() => setVisible(false), 500)
    return () => clearTimeout(timer)
  }, [activeBlockId])

  if (!visible || !path) return null

  return (
    <svg className='link-bridge-svg' aria-hidden='true'>
      <path d={path} className='link-bridge-path' />
    </svg>
  )
}
