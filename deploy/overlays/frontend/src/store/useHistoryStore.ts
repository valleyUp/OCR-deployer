import { create } from 'zustand'
import {
	clearAll,
	deleteRecord,
	getRecord,
	listRecords,
	pruneToQuota,
	putRecord,
	type HistoryRecord
} from '@/libs/historyDb'

interface HistoryState {
	records: HistoryRecord[]
	hydrated: boolean
	hydrate: () => Promise<void>
	upsert: (patch: Partial<HistoryRecord> & { localId: string }) => Promise<void>
	mergeServerRecords: (records: HistoryRecord[]) => Promise<void>
	remove: (localId: string) => Promise<void>
	clear: () => Promise<void>
	loadResult: (localId: string) => Promise<HistoryRecord | undefined>
}

function mergeRecord(
	existing: HistoryRecord | undefined,
	patch: Partial<HistoryRecord> & { localId: string }
): HistoryRecord {
	const defaults: HistoryRecord = {
		localId: patch.localId,
		fileName: '',
		fileSize: 0,
		fileType: '',
		processingMode: 'pipeline',
		status: 'pending',
		createdAt: Date.now()
	}
	return {
		...defaults,
		...(existing ?? {}),
		...patch
	}
}

export const useHistoryStore = create<HistoryState>((set, get) => ({
	records: [],
	hydrated: false,

	hydrate: async () => {
		if (get().hydrated) return
		try {
			const records = await listRecords()
			set({ records, hydrated: true })
		} catch (error) {
			console.error('[history] hydrate failed:', error)
			set({ hydrated: true })
		}
	},

	upsert: async patch => {
		const existing = get().records.find(r => r.localId === patch.localId)
		const next = mergeRecord(existing, patch)
		try {
			await putRecord(next)
			await pruneToQuota()
		} catch (error) {
			console.error('[history] upsert failed:', error)
		}
		set(state => {
			const rest = state.records.filter(r => r.localId !== next.localId)
			return { records: [next, ...rest] }
		})
	},

	mergeServerRecords: async incoming => {
		if (!incoming.length) return

		const existingRecords = get().records
		const byTaskId = new Map(
			existingRecords
				.filter(record => record.taskId !== undefined && record.taskId !== null)
				.map(record => [String(record.taskId), record])
		)
		const mergedByLocalId = new Map(existingRecords.map(record => [record.localId, record]))

		for (const record of incoming) {
			const existing = record.taskId !== undefined && record.taskId !== null
				? byTaskId.get(String(record.taskId))
				: undefined
			const localId = existing?.localId ?? record.localId
			const preservedResult = record.result === undefined ? existing?.result : record.result
			const next = mergeRecord(existing ?? mergedByLocalId.get(localId), {
				...record,
				localId,
				result: preservedResult,
				resultStripped: preservedResult
					? existing?.resultStripped
					: record.resultStripped ?? existing?.resultStripped,
			})
			mergedByLocalId.set(localId, next)
			if (next.taskId !== undefined && next.taskId !== null) {
				byTaskId.set(String(next.taskId), next)
			}
			try {
				await putRecord(next)
			} catch (error) {
				console.error('[history] merge server record failed:', error)
			}
		}

		try {
			await pruneToQuota()
		} catch (error) {
			console.error('[history] prune after server merge failed:', error)
		}

		set({ records: [...mergedByLocalId.values()].sort((a, b) => b.createdAt - a.createdAt) })
	},

	remove: async localId => {
		try {
			await deleteRecord(localId)
		} catch (error) {
			console.error('[history] delete failed:', error)
		}
		set(state => ({
			records: state.records.filter(r => r.localId !== localId)
		}))
	},

	clear: async () => {
		try {
			await clearAll()
		} catch (error) {
			console.error('[history] clear failed:', error)
		}
		set({ records: [] })
	},

	loadResult: async localId => {
		const inMemory = get().records.find(r => r.localId === localId)
		if (inMemory?.result) return inMemory
		try {
			const fromDb = await getRecord(localId)
			if (fromDb) {
				set(state => ({
					records: state.records.map(r =>
						r.localId === localId ? fromDb : r
					)
				}))
			}
			return fromDb
		} catch (error) {
			console.error('[history] loadResult failed:', error)
			return inMemory
		}
	}
}))
