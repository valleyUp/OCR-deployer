// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FormulaPanel } from './FormulaPanel'
import { useLinkStore } from '@/hooks/useLinkState'
import { useOcrStore } from '@/store/useOcrStore'

vi.mock('@/libs/api', () => ({
  exportTaskFormulas: vi.fn(),
  renderFormula: vi.fn(async () => new Blob(['<svg></svg>'], { type: 'image/svg+xml' })),
  renderFormulaText: vi.fn(),
}))

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

describe('FormulaPanel', () => {
  beforeEach(() => {
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:formula-preview'),
      revokeObjectURL: vi.fn(),
    })
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    useLinkStore.setState({ activeBlockId: null, source: null, eventId: 0, createdAt: 0, durationMs: 2200 })
    useOcrStore.setState({ hoveredBlockId: null, clickedBlockId: null, clickedPdfBlockId: null, blocks: [] })
  })

  it('uses compact UMath copy label and SVG preview rendering', async () => {
    render(
      <FormulaPanel
        taskId='task-1'
        formulas={[
          {
            formula_id: 'formula-1',
            task_id: 'task-1',
            block_id: 1,
            page_index: 1,
            latex: String.raw`\frac{a}{b}`,
          },
        ]}
      />
    )

    expect(screen.getByRole('button', { name: /LaTeX/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /MathML/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /UMath/ })).toBeTruthy()
    expect(screen.queryByText('UnicodeMath')).toBeNull()

    await waitFor(() => {
      expect(screen.getByAltText('Rendered formula')).toBeTruthy()
    })
  })
})
