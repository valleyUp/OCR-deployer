import { useEffect, useMemo, useState } from 'react'
import { FileUpload, type TaskResponse, type UploadedFile } from './FileUpload'
import { FilePreview } from './FilePreview'
import { OCRResults } from './OCRResults'
import { AppHeader } from '@/components/app/AppHeader'
import { HistoryPanel } from '@/components/app/HistoryPanel'
import { ResizableDivider } from '@/components/app/ResizableDivider'
import { useHistoryStore } from '@/store/useHistoryStore'
import { useConfigStore } from '@/store/useConfigStore'
import type { HistoryRecord } from '@/libs/historyDb'
import '@/styles-overlay.css'

const RESULTS_WIDTH_KEY = 'ocr-deployer:resultsWidth'
const RESULTS_WIDTH_DEFAULT = 560
const RESULTS_WIDTH_MIN = 360
const RESULTS_WIDTH_MAX = 1100

function readStoredWidth(): number {
	if (typeof window === 'undefined') return RESULTS_WIDTH_DEFAULT
	try {
		const raw = window.localStorage.getItem(RESULTS_WIDTH_KEY)
		if (!raw) return RESULTS_WIDTH_DEFAULT
		const parsed = Number.parseInt(raw, 10)
		if (Number.isNaN(parsed)) return RESULTS_WIDTH_DEFAULT
		return Math.min(RESULTS_WIDTH_MAX, Math.max(RESULTS_WIDTH_MIN, parsed))
	} catch {
		return RESULTS_WIDTH_DEFAULT
	}
}

function recordToUploadedFile(record: HistoryRecord): UploadedFile {
	const placeholder = new File([], record.fileName, {
		type: record.fileType || 'application/octet-stream'
	})
	return {
		id: record.localId,
		name: record.fileName,
		size: record.fileSize,
		type: record.fileType,
		file: placeholder,
		uploadTime: new Date(record.createdAt),
		error: record.errorMessage ?? null,
		processingMode: record.processingMode
	}
}

function recordToTaskResponse(record: HistoryRecord): TaskResponse | null {
	if (!record.result) return null
	return {
		fileId: record.localId,
		status: record.status === 'completed' ? 'completed' : 'failed',
		response: record.result,
		error_message: record.errorMessage ?? null
	}
}

export function OCRPage() {
	const [currentLocalId, setCurrentLocalId] = useState<string | null>(null)
	const [historyPreview, setHistoryPreview] = useState<{
		file: UploadedFile
		result: TaskResponse | null
	} | null>(null)
	const [resultsWidth, setResultsWidth] = useState<number>(RESULTS_WIDTH_DEFAULT)

	const ensureConfigLoaded = useConfigStore(s => s.ensureLoaded)
	const records = useHistoryStore(s => s.records)
	const hydrate = useHistoryStore(s => s.hydrate)

	useEffect(() => {
		setResultsWidth(readStoredWidth())
		void ensureConfigLoaded()
		void hydrate()
	}, [ensureConfigLoaded, hydrate])

	const activeRecord = useMemo(
		() => records.find(r => r.localId === currentLocalId) ?? null,
		[records, currentLocalId]
	)

	const uploadFile: UploadedFile | null = useMemo(() => {
		if (historyPreview?.file && historyPreview.file.id === currentLocalId) {
			return historyPreview.file
		}
		if (activeRecord) return recordToUploadedFile(activeRecord)
		return null
	}, [activeRecord, historyPreview, currentLocalId])

	const parsedResult: TaskResponse | null = useMemo(() => {
		if (historyPreview && historyPreview.file.id === currentLocalId) {
			return historyPreview.result
		}
		if (activeRecord) return recordToTaskResponse(activeRecord)
		return null
	}, [activeRecord, historyPreview, currentLocalId])

	const persistResultsWidth = (next: number) => {
		try {
			window.localStorage.setItem(RESULTS_WIDTH_KEY, String(next))
		} catch {
			/* ignore */
		}
	}

	const resetResultsWidth = () => {
		setResultsWidth(RESULTS_WIDTH_DEFAULT)
		persistResultsWidth(RESULTS_WIDTH_DEFAULT)
	}

	const handleHistorySelect = (record: HistoryRecord) => {
		setHistoryPreview(null)
		setCurrentLocalId(record.localId)
	}

	return (
		<div className='flex h-screen flex-col overflow-hidden bg-zinc-50'>
			<AppHeader uploadFile={uploadFile} result={parsedResult} />

			<div className='flex min-h-0 flex-1 overflow-hidden'>
				<aside className='flex w-60 shrink-0 flex-col overflow-hidden border-r border-border bg-white'>
					<FileUpload
						currentLocalId={currentLocalId}
						onActiveTaskChange={localId => {
							setHistoryPreview(null)
							setCurrentLocalId(localId)
						}}
					/>
					<HistoryPanel
						currentLocalId={currentLocalId}
						onSelect={handleHistorySelect}
					/>
				</aside>

				<main className='flex min-w-0 flex-1 overflow-hidden'>
					<section className='flex min-w-0 flex-1 flex-col overflow-hidden bg-white'>
						<FilePreview file={uploadFile} result={parsedResult} />
					</section>

					<ResizableDivider
						value={resultsWidth}
						onChange={setResultsWidth}
						onCommit={persistResultsWidth}
						onReset={resetResultsWidth}
						min={RESULTS_WIDTH_MIN}
						max={RESULTS_WIDTH_MAX}
						direction='right'
						ariaLabel='调整结果区宽度'
					/>

					<section
						className='flex shrink-0 flex-col overflow-hidden border-l border-border bg-white'
						style={{ width: `${resultsWidth}px` }}>
						<OCRResults result={parsedResult} fileName={uploadFile?.name} />
					</section>
				</main>
			</div>
		</div>
	)
}
