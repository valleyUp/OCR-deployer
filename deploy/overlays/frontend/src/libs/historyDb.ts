import type { TaskStatusData } from './api'

export type HistoryStatus =
	| 'pending'
	| 'processing'
	| 'completed'
	| 'failed'
	| 'cancelled'

export interface HistoryRecord {
	localId: string
	taskId?: string | number
	fileName: string
	fileSize: number
	fileType: string
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
const DB_VERSION = 1
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
			if (!db.objectStoreNames.contains(STORE_NAME)) {
				const store = db.createObjectStore(STORE_NAME, { keyPath: 'localId' })
				store.createIndex('createdAt', 'createdAt', { unique: false })
				store.createIndex('status', 'status', { unique: false })
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

export async function getRecord(localId: string): Promise<HistoryRecord | undefined> {
	const db = await openDb()
	return toPromise(
		db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(localId)
	)
}

export async function listRecords(): Promise<HistoryRecord[]> {
	const db = await openDb()
	const all = await toPromise<HistoryRecord[]>(
		db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAll()
	)
	all.sort((a, b) => b.createdAt - a.createdAt)
	return all
}

export async function deleteRecord(localId: string): Promise<void> {
	const db = await openDb()
	await toPromise(
		db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).delete(localId)
	)
}

export async function clearAll(): Promise<void> {
	const db = await openDb()
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
