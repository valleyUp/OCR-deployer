/**
 * Bidirectional link state: preview ↔ result block cross-highlighting.
 *
 * Flow:
 *   activate(blockId, 'preview') → highlights preview block, scrolls result, 2s fade
 *   activate(blockId, 'result')  → highlights result block, scrolls preview, 2s fade
 */

import { useCallback, useEffect, useRef } from 'react'
import { create } from 'zustand'

export type LinkSource = 'preview' | 'result'
const DEFAULT_DURATION_MS = 2200

interface LinkState {
  activeBlockId: string | null
  source: LinkSource | null
  eventId: number
  createdAt: number
  durationMs: number
  activate: (blockId: string, source: LinkSource, durationMs?: number) => void
  deactivate: () => void
}

export const useLinkStore = create<LinkState>((set) => ({
  activeBlockId: null,
  source: null,
  eventId: 0,
  createdAt: 0,
  durationMs: DEFAULT_DURATION_MS,
  activate: (blockId, source, durationMs = DEFAULT_DURATION_MS) => set(state => ({
    activeBlockId: blockId,
    source,
    eventId: state.eventId + 1,
    createdAt: Date.now(),
    durationMs
  })),
  deactivate: () => set({ activeBlockId: null, source: null })
}))

/**
 * Hook: use link state with auto-clear after 2000ms.
 * Pass scroll callbacks for bidirectional navigation.
 */
export function useLinkState(
  options?: {
    onNavigateToResult?: (blockId: string) => void
    onNavigateToPreview?: (blockId: string, pageIndex?: number) => void
  }
) {
  const activeBlockId = useLinkStore(s => s.activeBlockId)
  const source = useLinkStore(s => s.source)
  const eventId = useLinkStore(s => s.eventId)
  const durationMs = useLinkStore(s => s.durationMs)
  const activate = useLinkStore(s => s.activate)
  const deactivate = useLinkStore(s => s.deactivate)

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Auto-clear highlight after the current navigation event duration.
  useEffect(() => {
    if (activeBlockId) {
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => deactivate(), durationMs)
    }
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [activeBlockId, deactivate, durationMs, eventId])

  const triggerLink = useCallback((blockId: string, src: LinkSource) => {
    activate(blockId, src)
    if (src === 'preview') {
      options?.onNavigateToResult?.(blockId)
    } else {
      options?.onNavigateToPreview?.(blockId)
    }
  }, [activate, options])

  const clearLink = useCallback(() => {
    deactivate()
  }, [deactivate])

  const isActive = useCallback((blockId: string) =>
    activeBlockId === blockId
  , [activeBlockId])

  return { activeBlockId, source, eventId, triggerLink, clearLink, isActive }
}
