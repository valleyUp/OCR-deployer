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

function recordToUploadedFile(r: HistoryRecord): UploadedFile {
  return {
    id: r.localId, name: r.fileName, size: r.fileSize, type: r.fileType || 'application/octet-stream',
    file: new File([], r.fileName, { type: r.fileType || 'application/octet-stream' }),
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
  const [, setLiveFilesVersion] = useState(0)

  const ensureConfigLoaded = useConfigStore(s => s.ensureLoaded)
  const records = useHistoryStore(s => s.records)
  const hydrate = useHistoryStore(s => s.hydrate)

  useEffect(() => { setResultsWidth(readStoredWidth()); void ensureConfigLoaded(); void hydrate() }, [ensureConfigLoaded, hydrate])

  const activeRecord = useMemo(() => records.find(r => r.localId === currentLocalId) ?? null, [records, currentLocalId])

  const uploadFile: UploadedFile | null = useMemo(() => {
    if (currentLocalId && liveFilesRef.current.has(currentLocalId)) return liveFilesRef.current.get(currentLocalId)!
    if (activeRecord) return recordToUploadedFile(activeRecord)
    return null
  }, [activeRecord, currentLocalId])

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
      </main>
    </div>
  )
}
