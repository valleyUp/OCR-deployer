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

interface LinkState {
  activeBlockId: string | null
  source: LinkSource | null
  activate: (blockId: string, source: LinkSource) => void
  deactivate: () => void
}

export const useLinkStore = create<LinkState>((set) => ({
  activeBlockId: null,
  source: null,
  activate: (blockId, source) => set({ activeBlockId: blockId, source }),
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
  const activate = useLinkStore(s => s.activate)
  const deactivate = useLinkStore(s => s.deactivate)

  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  // Auto-clear highlight after 2000ms
  useEffect(() => {
    if (activeBlockId) {
      clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => deactivate(), 2000)
    }
    return () => clearTimeout(timerRef.current)
  }, [activeBlockId, deactivate])

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

  return { activeBlockId, source, triggerLink, clearLink, isActive }
}
