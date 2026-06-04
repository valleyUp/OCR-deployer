import api from './apiClient'
import type { AppConfig } from './apiTypes'

export async function getAppConfig(): Promise<AppConfig> {
	const response = await api.get<AppConfig>('/config')
	return response.data
}
