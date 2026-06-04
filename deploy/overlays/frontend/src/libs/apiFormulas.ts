import api from './apiClient'
import type { ApiResponse, FormulaFormat, TaskFormulasData } from './apiTypes'

export async function getTaskFormulas(taskId: string | number): Promise<TaskFormulasData> {
	const response = await api.get<ApiResponse<TaskFormulasData>>(`/tasks/${taskId}/formulas`)

	if (!response.data.success) {
		throw new Error(response.data.message || '查询公式失败')
	}

	return response.data.data
}

export async function renderFormula(
	latex: string,
	format: FormulaFormat
): Promise<Blob> {
	const response = await api.post(
		'/formulas/render',
		{ latex, format },
		{ responseType: 'blob' }
	)
	return response.data
}

export async function renderFormulaText(
	latex: string,
	format: 'latex' | 'mathml' | 'unicodemath'
): Promise<string> {
	if (format === 'latex') {
		return latex
	}
	const blob = await renderFormula(latex, format)
	return blob.text()
}

export async function exportTaskFormulas(
	taskId: string | number,
	formats: FormulaFormat[] = ['latex', 'mathml', 'unicodemath', 'png']
): Promise<Blob> {
	const response = await api.get(`/tasks/${taskId}/formulas/export`, {
		params: { formats: formats.join(',') },
		responseType: 'blob'
	})
	return response.data
}
