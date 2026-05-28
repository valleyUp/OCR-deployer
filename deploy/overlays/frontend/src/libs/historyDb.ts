import type { TaskStatusData } from './api'

export type HistoryStatus =
	| 'pending'
	| 'processing'
	| 'completed'
	| 'failed'
	| 'cancelled'

export interface HistoryRecord {
	localId: string
	ownerId: string
	taskId?: string | number
	fileName: string
	fileSize: number
	fileType: string
	sourceFilePath?: string | null
	resultAvailable?: boolean
	processingMode: 'pipeline' | 'formula'
	status: HistoryStatus
	currentStage?: string | null
	progress?: number | null
	createdAt: number
	startedAt?: number
	completedAt?: number
	executionTime?: number
	totalPages?: number
	errorMessage?: string | null
	result?: TaskStatusData | null
	resultStripped?: boolean
}

const DB_NAME = 'ocr-deployer'
const DB_VERSION = 2
const STORE_NAME = 'history'
const STORE_SIZE_LIMIT = 200 * 1024 * 1024 // 200 MB soft cap

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
	if (dbPromise) return dbPromise
	dbPromise = new Promise((resolve, reject) => {
		if (typeof indexedDB === 'undefined') {
			reject(new Error('IndexedDB is not available in this environment'))
			return
		}
		const request = indexedDB.open(DB_NAME, DB_VERSION)
		request.onupgradeneeded = () => {
			const db = request.result
			let store: IDBObjectStore
			if (!db.objectStoreNames.contains(STORE_NAME)) {
				store = db.createObjectStore(STORE_NAME, { keyPath: 'localId' })
				store.createIndex('createdAt', 'createdAt', { unique: false })
				store.createIndex('status', 'status', { unique: false })
			} else {
				store = request.transaction!.objectStore(STORE_NAME)
			}
			if (!store.indexNames.contains('ownerId')) {
				store.createIndex('ownerId', 'ownerId', { unique: false })
			}
		}
		request.onsuccess = () => resolve(request.result)
		request.onerror = () => reject(request.error ?? new Error('indexedDB open error'))
		request.onblocked = () => reject(new Error('indexedDB open blocked'))
	})
	return dbPromise
}

function toPromise<T>(request: IDBRequest<T>): Promise<T> {
	return new Promise((resolve, reject) => {
		request.onsuccess = () => resolve(request.result)
		request.onerror = () => reject(request.error ?? new Error('idb request error'))
	})
}

export async function putRecord(record: HistoryRecord): Promise<void> {
	const db = await openDb()
	await toPromise(
		db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).put(record)
	)
}

export async function getRecord(localId: string, ownerId?: string): Promise<HistoryRecord | undefined> {
	const db = await openDb()
	const record = await toPromise<HistoryRecord | undefined>(
		db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(localId)
	)
	if (ownerId && record?.ownerId !== ownerId) return undefined
	return record
}

export async function listRecords(ownerId?: string): Promise<HistoryRecord[]> {
	const db = await openDb()
	const all = await toPromise<HistoryRecord[]>(
		db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAll()
	)
	const records = ownerId ? all.filter(record => record.ownerId === ownerId) : all
	records.sort((a, b) => b.createdAt - a.createdAt)
	return records
}

export async function deleteRecord(localId: string): Promise<void> {
	const db = await openDb()
	await toPromise(
		db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).delete(localId)
	)
}

export async function clearAll(ownerId?: string): Promise<void> {
	const db = await openDb()
	if (ownerId) {
		const all = await listRecords(ownerId)
		await Promise.all(
			all.map(record => deleteRecord(record.localId))
		)
		return
	}
	await toPromise(
		db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).clear()
	)
}

async function estimateDatabaseUsage(): Promise<number> {
	try {
		if (navigator.storage?.estimate) {
			const est = await navigator.storage.estimate()
			if (typeof est.usage === 'number') return est.usage
		}
	} catch {
		/* fall through to manual estimation */
	}
	const records = await listRecords()
	let total = 0
	for (const record of records) {
		try {
			total += JSON.stringify(record).length
		} catch {
			total += 1024
		}
	}
	return total
}

// When total storage exceeds STORE_SIZE_LIMIT, strip the heaviest field
// (`result`) from oldest-completed records first; if still over, delete
// records entirely, oldest first.
export async function pruneToQuota(): Promise<void> {
	const initialUsage = await estimateDatabaseUsage()
	if (initialUsage < STORE_SIZE_LIMIT) return

	const records = await listRecords()
	const completedFirst = [...records].sort((a, b) => {
		const aDone = a.completedAt ?? a.createdAt
		const bDone = b.completedAt ?? b.createdAt
		return aDone - bDone
	})

	for (const record of completedFirst) {
		if (!record.result || record.resultStripped) continue
		await putRecord({ ...record, result: null, resultStripped: true })
		const usage = await estimateDatabaseUsage()
		if (usage < STORE_SIZE_LIMIT) return
	}

	for (const record of completedFirst) {
		if (record.status === 'processing' || record.status === 'pending') continue
		await deleteRecord(record.localId)
		const usage = await estimateDatabaseUsage()
		if (usage < STORE_SIZE_LIMIT) return
	}
}

export const HISTORY_SIZE_LIMIT = STORE_SIZE_LIMIT

// ── Deleted-task-ID tracking ──
// Persists IDs of server tasks the user explicitly deleted so that
// mergeServerRecords() won't resurrect them on the next page load.
const DELETED_TASK_IDS_KEY = 'ocr:deletedTaskIds'

function deletedTaskIdsKey(ownerId?: string): string {
	return ownerId ? `${DELETED_TASK_IDS_KEY}:${ownerId}` : DELETED_TASK_IDS_KEY
}

export function getDeletedTaskIds(ownerId?: string): Set<string> {
	try {
		const raw = localStorage.getItem(deletedTaskIdsKey(ownerId))
		if (!raw) return new Set()
		const parsed = JSON.parse(raw)
		return new Set(Array.isArray(parsed) ? parsed.map(String) : [])
	} catch {
		return new Set()
	}
}

export function addDeletedTaskIds(taskIds: (string | number)[], ownerId?: string): void {
	const existing = getDeletedTaskIds(ownerId)
	for (const id of taskIds) {
		if (id !== undefined && id !== null) existing.add(String(id))
	}
	try {
		localStorage.setItem(deletedTaskIdsKey(ownerId), JSON.stringify([...existing]))
	} catch { /* ignore quota errors */ }
}

export function clearDeletedTaskIds(ownerId?: string): void {
	try {
		localStorage.removeItem(deletedTaskIdsKey(ownerId))
	} catch { /* ignore */ }
}
