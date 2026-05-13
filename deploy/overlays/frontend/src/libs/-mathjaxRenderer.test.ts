import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { renderFormulaMock, renderFormulaTextMock } = vi.hoisted(() => ({
	renderFormulaMock: vi.fn(async () => new Blob(['<svg><text>x</text></svg>'])),
	renderFormulaTextMock: vi.fn(async (_latex: string, format: string) => `<${format}>x</${format}>`),
}))

vi.mock('./api', () => ({
	renderFormula: renderFormulaMock,
	renderFormulaText: renderFormulaTextMock,
}))

describe('mathjaxRenderer', () => {
	beforeEach(async () => {
		const { clearFormulaRenderCache } = await import('./mathjaxRenderer')
		clearFormulaRenderCache()
		renderFormulaMock.mockClear()
		renderFormulaTextMock.mockClear()
	})

	it('does not load MathJax from a public CDN at runtime', () => {
		const source = readFileSync(new URL('./mathjaxRenderer.ts', import.meta.url), 'utf-8')
		expect(source).not.toContain('cdn.jsdelivr')
		expect(source).not.toContain('https://')
	})

	it('caches backend formula rendering by format and source', async () => {
		const { renderFormulaSvg } = await import('./mathjaxRenderer')

		await expect(renderFormulaSvg('x+y')).resolves.toContain('<svg')
		await expect(renderFormulaSvg('x+y')).resolves.toContain('<svg')

		expect(renderFormulaMock).toHaveBeenCalledTimes(1)
		expect(renderFormulaMock).toHaveBeenCalledWith('x+y', 'svg')
	})
})
