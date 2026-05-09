import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
const RESULTS_WIDTH_DEFAULT = 420
const RESULTS_WIDTH_MIN = 340
const RESULTS_WIDTH_MAX = 760

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
	const [resultsWidth, setResultsWidth] = useState<number>(RESULTS_WIDTH_DEFAULT)

	// Live uploads have real File references that cannot be serialised
	// into history. Keep a side-map so FilePreview can render before the
	// task completes.
	const liveFilesRef = useRef<Map<string, UploadedFile>>(new Map())
	const [, setLiveFilesVersion] = useState(0)

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
		if (currentLocalId && liveFilesRef.current.has(currentLocalId)) {
			return liveFilesRef.current.get(currentLocalId)!
		}
		if (activeRecord) return recordToUploadedFile(activeRecord)
		return null
	}, [activeRecord, currentLocalId])

	const parsedResult: TaskResponse | null = useMemo(() => {
		if (activeRecord) return recordToTaskResponse(activeRecord)
		return null
	}, [activeRecord])

	const handleFileReady = useCallback((uploadedFile: UploadedFile) => {
		liveFilesRef.current.set(uploadedFile.id, uploadedFile)
		setLiveFilesVersion(v => v + 1)
	}, [])

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

	return (
		<div className='ocr-app-shell flex h-screen flex-col overflow-hidden p-3'>
			<div className='ocr-window flex min-h-0 flex-1 flex-col overflow-hidden'>
				<AppHeader uploadFile={uploadFile} result={parsedResult} />

				<div className='flex min-h-0 flex-1 gap-3 overflow-hidden p-3 pt-0'>
					<aside className='ocr-glass-panel flex w-[286px] shrink-0 flex-col overflow-hidden'>
						<FileUpload
							currentLocalId={currentLocalId}
							onActiveTaskChange={localId => {
								setCurrentLocalId(localId)
							}}
							onFileReady={handleFileReady}
						/>
						<HistoryPanel
							currentLocalId={currentLocalId}
							onSelect={record => setCurrentLocalId(record.localId)}
						/>
					</aside>

					<main className='flex min-w-0 flex-1 overflow-hidden'>
						<section className='ocr-glass-panel flex min-w-0 flex-1 flex-col overflow-hidden'>
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
							className='mx-1'
						/>

						<section
							className='ocr-glass-panel flex shrink-0 flex-col overflow-hidden'
							style={{ width: `${resultsWidth}px` }}>
							<OCRResults result={parsedResult} fileName={uploadFile?.name} />
						</section>
					</main>
				</div>
			</div>
		</div>
	)
}
