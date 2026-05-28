import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { HistoryRecord } from '@/libs/historyDb'

const {
	addDeletedTaskIdsMock,
	clearAllMock,
	deleteAllTasksMock,
	deleteRecordMock,
	deleteTaskMock,
	getDeletedTaskIdsMock,
	getRecordMock,
	listRecordsMock,
	pruneToQuotaMock,
	putRecordMock,
} = vi.hoisted(() => ({
	addDeletedTaskIdsMock: vi.fn(),
	clearAllMock: vi.fn(),
	deleteAllTasksMock: vi.fn(),
	deleteRecordMock: vi.fn(),
	deleteTaskMock: vi.fn(),
	getDeletedTaskIdsMock: vi.fn(() => new Set<string>()),
	getRecordMock: vi.fn(),
	listRecordsMock: vi.fn(),
	pruneToQuotaMock: vi.fn(),
	putRecordMock: vi.fn(),
}))

vi.mock('@/libs/api', () => ({
	deleteAllTasks: deleteAllTasksMock,
	deleteTask: deleteTaskMock,
}))

vi.mock('sonner', () => ({
	toast: { error: vi.fn() },
}))

vi.mock('@/libs/historyDb', () => ({
	addDeletedTaskIds: addDeletedTaskIdsMock,
	clearAll: clearAllMock,
	deleteRecord: deleteRecordMock,
	getDeletedTaskIds: getDeletedTaskIdsMock,
	getRecord: getRecordMock,
	listRecords: listRecordsMock,
	pruneToQuota: pruneToQuotaMock,
	putRecord: putRecordMock,
}))

function record(localId: string, ownerId: string): HistoryRecord {
	return {
		localId,
		ownerId,
		fileName: `${localId}.pdf`,
		fileSize: 1,
		fileType: 'application/pdf',
		processingMode: 'pipeline',
		status: 'completed',
		createdAt: 1,
	}
}

describe('useHistoryStore owner scoping', () => {
	beforeEach(async () => {
		vi.clearAllMocks()
		const { useHistoryStore } = await import('./useHistoryStore')
		useHistoryStore.setState({
			records: [],
			hydrated: false,
			ownerId: null,
		})
	})

	it('hydrates only records for the active owner', async () => {
		const ownerARecord = record('a', 'owner-a')
		const ownerBRecord = record('b', 'owner-b')
		listRecordsMock.mockImplementation(async (ownerId: string) =>
			[ownerARecord, ownerBRecord].filter(item => item.ownerId === ownerId)
		)
		const { useHistoryStore } = await import('./useHistoryStore')

		await useHistoryStore.getState().setOwner('owner-a')
		expect(useHistoryStore.getState().records).toEqual([ownerARecord])

		await useHistoryStore.getState().setOwner('owner-b')
		expect(useHistoryStore.getState().records).toEqual([ownerBRecord])
	})

	it('stamps new records with the active owner', async () => {
		listRecordsMock.mockResolvedValue([])
		const { useHistoryStore } = await import('./useHistoryStore')

		await useHistoryStore.getState().setOwner('owner-a')
		await useHistoryStore.getState().upsert({
			localId: 'new',
			fileName: 'new.pdf',
			fileSize: 1,
			fileType: 'application/pdf',
			processingMode: 'pipeline',
			status: 'pending',
			createdAt: 1,
		})

		expect(putRecordMock).toHaveBeenCalledWith(
			expect.objectContaining({ localId: 'new', ownerId: 'owner-a' })
		)
		expect(useHistoryStore.getState().records[0].ownerId).toBe('owner-a')
	})

	it('calls server delete before removing local server records', async () => {
		listRecordsMock.mockResolvedValue([])
		const { useHistoryStore } = await import('./useHistoryStore')

		await useHistoryStore.getState().setOwner('owner-a')
		await useHistoryStore.getState().upsert({
			localId: 'local-a',
			taskId: 'task-a',
			fileName: 'a.pdf',
			fileSize: 1,
			fileType: 'application/pdf',
			processingMode: 'pipeline',
			status: 'completed',
			createdAt: 1,
		})
		await useHistoryStore.getState().remove('local-a')

		expect(deleteTaskMock).toHaveBeenCalledWith('task-a')
		expect(addDeletedTaskIdsMock).toHaveBeenCalledWith(['task-a'], 'owner-a')
		expect(deleteRecordMock).toHaveBeenCalledWith('local-a')
	})
})
