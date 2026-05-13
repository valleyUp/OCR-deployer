import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FileUpload, type TaskResponse, type UploadedFile } from './FileUpload'
import { FilePreview } from './FilePreview'
import { OCRResults } from './OCRResults'
import { AppHeader } from '@/components/app/AppHeader'
import { HistoryPanel } from '@/components/app/HistoryPanel'
import { ResizableDivider } from '@/components/app/ResizableDivider'
import { LinkBridge } from '@/components/link/LinkBridge'
import { useHistoryStore } from '@/store/useHistoryStore'
import { useConfigStore } from '@/store/useConfigStore'
import { getTaskStatus, listTasks, taskFileUrl, type TaskListItem } from '@/libs/api'
import type { HistoryRecord } from '@/libs/historyDb'
import '@/styles-overlay.css'

const RESULTS_WIDTH_KEY = 'ocr:resultsWidth'
const RESULTS_WIDTH_DEFAULT = 420
const RESULTS_WIDTH_MIN = 300
const RESULTS_WIDTH_MAX = 9999

function readStoredWidth(): number {
  try {
    const raw = localStorage.getItem(RESULTS_WIDTH_KEY)
    if (!raw) return RESULTS_WIDTH_DEFAULT
    const n = parseInt(raw, 10)
    return isNaN(n) ? RESULTS_WIDTH_DEFAULT : Math.min(RESULTS_WIDTH_MAX, Math.max(RESULTS_WIDTH_MIN, n))
  } catch { return RESULTS_WIDTH_DEFAULT }
}

function parseTaskTime(value?: string | null): number | undefined {
  if (!value) return undefined
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? ms : undefined
}

function mimeFromTaskFile(name?: string | null, fileType?: string | null): string {
  const raw = (fileType || '').trim().toLowerCase()
  if (raw.includes('/')) return raw
  const lower = (name || '').toLowerCase()
  if (raw === 'pdf' || lower.endsWith('.pdf')) return 'application/pdf'
  if (raw === 'png' || lower.endsWith('.png')) return 'image/png'
  if (raw === 'jpg' || raw === 'jpeg' || /\.(jpe?g)$/i.test(lower)) return 'image/jpeg'
  if (raw === 'webp' || lower.endsWith('.webp')) return 'image/webp'
  return 'application/octet-stream'
}

function toHistoryStatus(status: TaskListItem['status']): HistoryRecord['status'] {
  if (status === 'pending' || status === 'processing' || status === 'completed' || status === 'cancelled') return status
  return 'failed'
}

function serverTaskToRecord(task: TaskListItem): HistoryRecord {
  const taskId = String(task.task_id)
  const fileName = task.original_filename || `task-${taskId}`
  return {
    localId: `task:${taskId}`,
    taskId,
    fileName,
    fileSize: task.file_size ?? 0,
    fileType: mimeFromTaskFile(fileName, task.file_type),
    sourceFilePath: task.source_file_path,
    resultAvailable: task.result_available,
    processingMode: task.processing_mode === 'formula' ? 'formula' : 'pipeline',
    status: toHistoryStatus(task.status),
    currentStage: task.current_stage ?? task.current_step,
    progress: task.progress,
    createdAt: parseTaskTime(task.created_at) ?? Date.now(),
    startedAt: parseTaskTime(task.started_at),
    completedAt: parseTaskTime(task.completed_at),
    executionTime: task.execution_time ?? undefined,
    totalPages: task.total_pages ?? undefined,
    errorMessage: task.error_message,
    resultStripped: Boolean(task.result_available),
  }
}

export function recordToUploadedFile(r: HistoryRecord): UploadedFile {
  const result = r.result
  const previewUrl = taskFileUrl(result?.source_file_path || r.sourceFilePath)
  return {
    id: r.localId, name: result?.original_filename || r.fileName, size: r.fileSize, type: r.fileType || 'application/octet-stream',
    file: new File([], r.fileName, { type: r.fileType || 'application/octet-stream' }),
    previewUrl,
    uploadTime: new Date(r.createdAt), error: r.errorMessage ?? null, processingMode: r.processingMode
  }
}

function recordToTaskResponse(r: HistoryRecord): TaskResponse | null {
  if (!r.result) return null
  return {
    fileId: r.localId,
    status: r.status === 'completed' ? 'completed' : 'failed',
    response: r.result, error_message: r.errorMessage ?? null
  }
}

export function OCRPage() {
  const [currentLocalId, setCurrentLocalId] = useState<string | null>(null)
  const [resultsWidth, setResultsWidth] = useState(RESULTS_WIDTH_DEFAULT)
  const liveFilesRef = useRef<Map<string, UploadedFile>>(new Map())
  const serverHistoryLoadedRef = useRef(false)
  const [liveFilesVersion, setLiveFilesVersion] = useState(0)

  const ensureConfigLoaded = useConfigStore(s => s.ensureLoaded)
  const records = useHistoryStore(s => s.records)
  const hydrated = useHistoryStore(s => s.hydrated)
  const hydrate = useHistoryStore(s => s.hydrate)
  const upsertHistory = useHistoryStore(s => s.upsert)
  const mergeServerRecords = useHistoryStore(s => s.mergeServerRecords)

  useEffect(() => { setResultsWidth(readStoredWidth()); void ensureConfigLoaded(); void hydrate() }, [ensureConfigLoaded, hydrate])

  useEffect(() => {
    if (!hydrated || serverHistoryLoadedRef.current) return
    serverHistoryLoadedRef.current = true
    let cancelled = false
    const sync = async () => {
      try {
        const data = await listTasks({ limit: 100 })
        if (cancelled) return
        await mergeServerRecords(data.tasks.map(serverTaskToRecord))
      } catch (error) {
        console.error('[history] server sync failed:', error)
      }
    }
    void sync()
    return () => { cancelled = true }
  }, [hydrated, mergeServerRecords])

  const activeRecord = useMemo(() => records.find(r => r.localId === currentLocalId) ?? null, [records, currentLocalId])

  useEffect(() => {
    if (!activeRecord?.taskId) return
    if (activeRecord.result?.source_file_path) return
    if (activeRecord.status !== 'completed' && activeRecord.status !== 'failed') return

    let cancelled = false
    const refresh = async () => {
      try {
        const result = await getTaskStatus(activeRecord.taskId!)
        if (cancelled) return
        await upsertHistory({
          localId: activeRecord.localId,
          taskId: String(activeRecord.taskId),
          status: result.status === 'completed' ? 'completed' : result.status === 'failed' ? 'failed' : activeRecord.status,
          currentStage: result.current_stage ?? result.current_step,
          progress: result.progress,
          executionTime: result.execution_time,
          totalPages: result.metadata?.total_pages,
          errorMessage: result.error_message,
          sourceFilePath: result.source_file_path,
          resultAvailable: true,
          result,
        })
      } catch (error) {
        console.error('[history] refresh source file failed:', error)
      }
    }
    void refresh()
    return () => { cancelled = true }
  }, [activeRecord, upsertHistory])

  const uploadFile: UploadedFile | null = useMemo(() => {
    if (currentLocalId && liveFilesRef.current.has(currentLocalId)) return liveFilesRef.current.get(currentLocalId)!
    if (activeRecord) return recordToUploadedFile(activeRecord)
    return null
  }, [activeRecord, currentLocalId, liveFilesVersion])

  const parsedResult: TaskResponse | null = useMemo(() => {
    if (activeRecord) return recordToTaskResponse(activeRecord)
    return null
  }, [activeRecord])

  const handleFileReady = useCallback((f: UploadedFile) => {
    liveFilesRef.current.set(f.id, f); setLiveFilesVersion(v => v + 1)
  }, [])

  const persistWidth = (n: number) => { try { localStorage.setItem(RESULTS_WIDTH_KEY, String(n)) } catch { /* */ } }
  const resetWidth = () => { setResultsWidth(RESULTS_WIDTH_DEFAULT); persistWidth(RESULTS_WIDTH_DEFAULT) }

  return (
    <div className='app'>
      <AppHeader uploadFile={uploadFile} result={parsedResult} />
      <main className='shell'>
        <aside className='sidebar'>
          <FileUpload
            currentLocalId={currentLocalId}
            onActiveTaskChange={id => setCurrentLocalId(id)}
            onFileReady={handleFileReady}
          />
          <HistoryPanel
            currentLocalId={currentLocalId}
            onSelect={r => setCurrentLocalId(r.localId)}
          />
        </aside>

        <FilePreview file={uploadFile} result={parsedResult} />

        <ResizableDivider
          value={resultsWidth} onChange={setResultsWidth} onCommit={persistWidth}
          onReset={resetWidth} min={RESULTS_WIDTH_MIN} max={RESULTS_WIDTH_MAX}
          direction='right' ariaLabel='调整结果区宽度'
        />

        <section className='inspector' style={{ width: resultsWidth, minWidth: resultsWidth, flexShrink: 0 }}>
          <OCRResults result={parsedResult} fileName={uploadFile?.name} />
        </section>
        <LinkBridge />
      </main>
    </div>
  )
}
