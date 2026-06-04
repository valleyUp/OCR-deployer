import axios from 'axios'

export const BASE_URL = import.meta.env.VITE_API_URL || '/api/v1'

export const api = axios.create({
	baseURL: BASE_URL,
	timeout: 60000,
	withCredentials: true
})

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null
}

function stringField(value: unknown, key: string): string | undefined {
	if (!isRecord(value)) return undefined
	const field = value[key]
	return typeof field === 'string' && field.trim() ? field : undefined
}

export function getApiErrorMessage(error: unknown, fallback: string): string {
	if (isRecord(error)) {
		const response = error.response
		if (isRecord(response)) {
			const data = response.data
			return stringField(data, 'detail') ?? stringField(data, 'message') ?? stringField(data, 'error') ?? fallback
		}
	}
	if (error instanceof Error && error.message.trim()) return error.message
	return fallback
}

api.interceptors.response.use(
	response => response,
	error => {
		console.error(getApiErrorMessage(error, 'API request failed'))
		return Promise.reject(error)
	}
)

export default api
