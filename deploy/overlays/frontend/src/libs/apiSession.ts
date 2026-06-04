import api from './apiClient'
import type { SessionData } from './apiTypes'

export async function getSession(): Promise<SessionData> {
	const response = await api.get<SessionData>('/session')
	return response.data
}
