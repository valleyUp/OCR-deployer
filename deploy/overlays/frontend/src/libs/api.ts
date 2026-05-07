import axios from 'axios'

const BASE_URL = import.meta.env.VITE_API_URL || '/api/v1'

// 创建 axios 实例
const api = axios.create({
	baseURL: BASE_URL,
	timeout: 60000 // 60秒超时
})

// 请求拦截器
api.interceptors.request.use(
	config => {
		// 可以在这里添加 token 等认证信息
		return config
	},
	error => {
		return Promise.reject(error)
	}
)

// 响应拦截器
api.interceptors.response.use(
	response => {
		return response
	},
	error => {
		// 统一错误处理
		if (error.response) {
			// 服务器返回了错误状态码
			console.error('API Error:', error.response.data)
		} else if (error.request) {
			// 请求已发出但没有收到响应
			console.error('Network Error:', error.request)
		} else {
			// 其他错误
			console.error('Error:', error.message)
		}
		return Promise.reject(error)
	}
)

// API 统一响应格式
export interface ApiResponse<T> {
	success: boolean
	data: T
	message?: string | null
	error?: string | null
}

// 上传接口返回的 data 结构
export interface UploadTaskData {
	task_id: string | number
	document_id: string
	created_at: string
	priority: string | number
	status: string
	error?: string | null
	message?: string | null
}

export interface UploadTaskResponse extends ApiResponse<UploadTaskData> {}

export interface UploadTaskParams {
	file: File
	custom_url?: string
	processing_mode?: 'pipeline' | 'formula'
}

export type TaskStatus = 'pending' | 'processing' | 'completed' | 'failed'

// 轮询接口返回的 data 结构
export interface TaskStatusData {
	task_id: string | number
	document_id: string
	status: TaskStatus
	progress?: number
	current_stage?: string | null
	created_at: string
	started_at?: string
	completed_at?: string
	error_message?: string | null
	result_file_path?: string
	result?: {
		output_path?: string
		output_files?: string[]
		metadata?: {
			total_pages?: number
			total_text_length?: number
			word_count?: number
			processing_mode?: string
			source_type?: string
		}
		execution_time?: number
		stage_results?: any
	}
	priority: number
	full_markdown?: string
	metadata?: {
		task_id?: string
		document_id?: string
		original_filename?: string
		processing_mode?: string
		total_pages?: number
		merge_timestamp?: number
		width?: number
		height?: number
	}
	layout?: Array<{
		block_content: string
		bbox: [number, number, number, number]
		block_id: number
		text_length?: number | null
		page_index: number
		layout_type?: string
		formula_id?: string
		formula?: {
			latex: string
		}
	}>
	images?: Record<string, string>
	formulas?: FormulaItem[]
}

export interface FormulaItem {
	formula_id: string
	task_id?: string | number | null
	block_id?: string | number | null
	page_index: number
	bbox?: [number, number, number, number] | null
	layout_type?: string
	latex: string
	formula?: {
		latex: string
	}
}

export interface TaskFormulasData {
	task_id: string | number
	count: number
	formulas: FormulaItem[]
}

export interface TaskStatusResponse extends ApiResponse<TaskStatusData> {}

/**
 * 上传文件并创建 OCR 任务
 * @param params 上传参数
 * @returns Promise<UploadTaskData>
 */
export async function uploadTask(params: UploadTaskParams): Promise<UploadTaskData> {
	const formData = new FormData()
	formData.append('file', params.file)
	formData.append('processing_mode', params.processing_mode || 'pipeline')
	if (params.custom_url) {
		formData.append('custom_url', params.custom_url)
	}

	const response = await api.post<UploadTaskResponse>('/tasks/upload', formData)

	if (!response.data.success) {
		throw new Error(response.data.message || '上传失败')
	}

	return response.data.data
}

export async function getTaskFormulas(taskId: string | number): Promise<TaskFormulasData> {
	const response = await api.get<ApiResponse<TaskFormulasData>>(`/tasks/${taskId}/formulas`)

	if (!response.data.success) {
		throw new Error(response.data.message || '查询公式失败')
	}

	return response.data.data
}

export type FormulaFormat = 'latex' | 'mathml' | 'unicodemath' | 'png'

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

/**
 * 查询任务状态
 * @param taskId 任务 ID
 * @returns Promise<TaskStatusData>
 */
export async function getTaskStatus(taskId: string | number): Promise<TaskStatusData> {
	const response = await api.get<TaskStatusResponse>(`/tasks/${taskId}`)

	if (!response.data.success) {
		throw new Error(response.data.message || '查询任务状态失败')
	}

	return response.data.data
}

export default api
