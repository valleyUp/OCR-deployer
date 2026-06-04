import api, { BASE_URL } from './apiClient'
import type {
	ApiResponse,
	TaskStatusData,
	TaskStatusResponse,
	TasksListData,
	UploadTaskData,
	UploadTaskParams,
	UploadTaskResponse,
} from './apiTypes'

export async function listTasks(params: { status?: string; limit?: number; offset?: number } = {}): Promise<TasksListData> {
	const response = await api.get<ApiResponse<TasksListData>>('/tasks/', { params })

	if (!response.data.success) {
		throw new Error(response.data.message || '查询任务列表失败')
	}

	return response.data.data
}

export async function deleteTask(taskId: string | number): Promise<void> {
	const response = await api.delete<ApiResponse<{ task_id: string | number; deleted: boolean }>>(`/tasks/${taskId}`)

	if (!response.data.success) {
		throw new Error(response.data.message || '删除任务失败')
	}
}

export async function deleteAllTasks(): Promise<void> {
	const response = await api.delete<ApiResponse<{ deleted: number }>>('/tasks/')

	if (!response.data.success) {
		throw new Error(response.data.message || '清空任务失败')
	}
}

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

export function taskFileUrl(path?: string | null): string | undefined {
	if (!path) return undefined
	return `${BASE_URL}/tasks/file?path=${encodeURIComponent(path)}`
}

export async function getTaskStatus(taskId: string | number): Promise<TaskStatusData> {
	const response = await api.get<TaskStatusResponse>(`/tasks/${taskId}`)

	if (!response.data.success) {
		throw new Error(response.data.message || '查询任务状态失败')
	}

	return response.data.data
}
