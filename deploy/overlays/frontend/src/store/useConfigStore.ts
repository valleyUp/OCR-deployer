import { create } from 'zustand'
import { getAppConfig, type AppConfig } from '@/libs/api'

interface ConfigState {
	maxUploadMb: number
	workerCount: number
	maxConcurrentTasks: number
	layoutPageParallelism: number
	taskTimeout: number
	loaded: boolean
	ensureLoaded: () => Promise<void>
}

const DEFAULTS: AppConfig = {
	max_upload_mb: 100,
	worker_count: 5,
	max_concurrent_tasks: 5,
	layout_page_parallelism: 1,
	task_timeout: 3600
}

export const useConfigStore = create<ConfigState>((set, get) => ({
	maxUploadMb: DEFAULTS.max_upload_mb,
	workerCount: DEFAULTS.worker_count,
	maxConcurrentTasks: DEFAULTS.max_concurrent_tasks,
	layoutPageParallelism: DEFAULTS.layout_page_parallelism,
	taskTimeout: DEFAULTS.task_timeout,
	loaded: false,

	ensureLoaded: async () => {
		if (get().loaded) return
		try {
			const cfg = await getAppConfig()
			set({
				maxUploadMb: cfg.max_upload_mb,
				workerCount: cfg.worker_count,
				maxConcurrentTasks: cfg.max_concurrent_tasks,
				layoutPageParallelism: cfg.layout_page_parallelism,
				taskTimeout: cfg.task_timeout,
				loaded: true
			})
		} catch (error) {
			console.warn('[config] fetch failed, using defaults:', error)
			set({ loaded: true })
		}
	}
}))
