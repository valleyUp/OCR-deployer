export interface ApiResponse<T> {
	success: boolean
	data: T
	message?: string | null
	error?: string | null
}

export interface SessionData {
	owner_id: string
}

export interface UploadTaskData {
	task_id: string | number
	document_id: string
	created_at: string
	priority: string | number
	status: string
	processing_mode?: 'pipeline' | 'formula' | string
	error?: string | null
	message?: string | null
}

export interface UploadTaskResponse extends ApiResponse<UploadTaskData> {}

export interface UploadTaskParams {
	file: File
	custom_url?: string
	processing_mode?: 'pipeline' | 'formula'
}

export type TaskStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled' | 'dead_letter'

export interface TaskResultMetadata {
	total_pages?: number
	total_text_length?: number
	word_count?: number
	processing_mode?: string
	source_type?: string
}

export interface TaskLayoutBlock {
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
}

export interface TaskStatusData {
	task_id: string | number
	document_id: string
	status: TaskStatus
	processing_mode?: 'pipeline' | 'formula' | string
	progress?: number
	current_stage?: string | null
	current_step?: string | null
	execution_time?: number
	created_at: string
	started_at?: string
	completed_at?: string
	error_message?: string | null
	result_file_path?: string
	original_filename?: string
	source_file_path?: string
	result?: {
		output_path?: string
		output_files?: string[]
		metadata?: TaskResultMetadata
		execution_time?: number
		stage_results?: unknown
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
	layout?: TaskLayoutBlock[]
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

export interface TaskListItem {
	task_id: string | number
	document_id?: string
	status: TaskStatus
	processing_mode?: 'pipeline' | 'formula' | string
	progress?: number | null
	current_stage?: string | null
	current_step?: string | null
	execution_time?: number | null
	created_at?: string | null
	started_at?: string | null
	completed_at?: string | null
	error_message?: string | null
	priority?: number | null
	retry_count?: number | null
	original_filename?: string | null
	file_size?: number | null
	file_type?: string | null
	source_file_path?: string | null
	result_file_path?: string | null
	result_available?: boolean
	total_pages?: number | null
}

export interface TasksListData {
	tasks: TaskListItem[]
	total: number
	limit: number
	offset: number
}

export type FormulaFormat = 'latex' | 'mathml' | 'unicodemath' | 'svg' | 'png'

export interface AppConfig {
	max_upload_mb: number
	worker_count: number
	max_concurrent_tasks: number
	layout_page_parallelism: number
	task_timeout: number
}
