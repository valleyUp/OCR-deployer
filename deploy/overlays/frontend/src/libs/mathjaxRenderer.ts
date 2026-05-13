import { renderFormula, renderFormulaText } from './api'

type FormulaTextFormat = 'mathml' | 'unicodemath'
type FormulaRenderFormat = FormulaTextFormat | 'svg'

const renderCache = new Map<string, Promise<string>>()

function cacheKey(format: FormulaRenderFormat, latex: string): string {
	return `${format}:${latex}`
}

function cached(format: FormulaRenderFormat, latex: string, render: () => Promise<string>): Promise<string> {
	const key = cacheKey(format, latex)
	const existing = renderCache.get(key)
	if (existing) return existing

	const promise = render().catch(error => {
		renderCache.delete(key)
		throw error
	})
	renderCache.set(key, promise)
	return promise
}

export function isMathJaxReady(): boolean {
	return true
}

export async function renderFormulaSvg(latex: string): Promise<string> {
	return cached('svg', latex, async () => {
		const blob = await renderFormula(latex, 'svg')
		return blob.text()
	})
}

export async function renderFormulaMathML(latex: string): Promise<string> {
	return cached('mathml', latex, () => renderFormulaText(latex, 'mathml'))
}

export async function renderFormulaUnicodeMath(latex: string): Promise<string> {
	return cached('unicodemath', latex, () => renderFormulaText(latex, 'unicodemath'))
}

export function clearFormulaRenderCache(): void {
	renderCache.clear()
}
