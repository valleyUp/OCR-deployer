import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, FileText, Loader2, Sigma, Upload } from 'lucide-react'
import { cn } from '@/libs/utils'
import { getTaskStatus, uploadTask, type TaskStatus, type TaskStatusData } from '@/libs/api'
import { toast } from 'sonner'
import { useHistoryStore } from '@/store/useHistoryStore'
import { useConfigStore } from '@/store/useConfigStore'
import { formatFileSize } from '@/libs/format'
import type { HistoryRecord } from '@/libs/historyDb'

export type Layout = {
  block_content: string; bbox: [number, number, number, number] | null
  block_id: number; text_length?: number | null
}
export interface UploadedFile {
  id: string; name: string; size: number; type: string; file: File; previewUrl?: string
  uploadTime: Date; error: string | null; processingMode: ProcessingMode
}
export interface TaskResponse {
  fileId: string; status: TaskStatus
  response: TaskStatusData | null; error_message?: string | null
}
interface FileUploadProps { currentLocalId: string | null; onActiveTaskChange: (id: string | null) => void; onFileReady?: (f: UploadedFile) => void }

const ALLOWED_TYPES = ['image/png','image/jpeg','image/jpg','application/pdf']
const ALLOWED_EXTS = ['.png','.jpg','.jpeg','.pdf']
type ProcessingMode = 'pipeline' | 'formula'
const POLL_MS = 2000

const STAGES = [
  { id:'upload', label:'Upload', matchers:['upload','queued','pending'] },
  { id:'pdf', label:'Read', matchers:['pdf_to_image','image'] },
  { id:'ocr', label:'OCR', matchers:['layout_and_ocr','layout','ocr','recogniz'] },
  { id:'merge', label:'Merge', matchers:['result_merge','merge','render','finaliz'] }
]

function genId() { return crypto.randomUUID?.() ?? `u-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,10)}` }
function normType(f:File) { return f.type || (f.name.toLowerCase().endsWith('.pdf')?'application/pdf':f.name.toLowerCase().endsWith('.png')?'image/png':'image/jpeg') }
function isValid(f:File) { return ALLOWED_TYPES.includes(normType(f)) || ALLOWED_EXTS.some(e=>f.name.toLowerCase().endsWith(e)) }
function toHistStatus(s:TaskStatus): HistoryRecord['status'] { return s==='pending'?'pending':s==='processing'?'processing':s==='completed'?'completed':'failed' }
function resolveStage(s?:string|null) { if(!s)return 0; const l=s.toLowerCase(); for(let i=STAGES.length-1;i>=0;i--)if(STAGES[i].matchers.some(t=>l.includes(t)))return i; return 0 }

export function FileUpload({ currentLocalId, onActiveTaskChange, onFileReady }: FileUploadProps) {
  const upsertHistory = useHistoryStore(s=>s.upsert)
  const historyRecords = useHistoryStore(s=>s.records)
  const maxUploadMb = useConfigStore(s=>s.maxUploadMb)
  const [processingMode,setMode] = useState<ProcessingMode>('pipeline')
  const [pasteActive,setPasteActive] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const pollingRef = useRef<Map<string,ReturnType<typeof setInterval>>>(new Map())

  const activeRecord = useMemo(()=>historyRecords.find(r=>r.localId===currentLocalId)??null,[historyRecords,currentLocalId])
  const maxBytes = useMemo(()=>Math.max(1,maxUploadMb)*1024*1024,[maxUploadMb])

  const stopPoll = (id:string)=>{const h=pollingRef.current.get(id);if(h){clearInterval(h);pollingRef.current.delete(id)}}

  const handleFile = async (file:File) => {
    const localId = genId()
    const base = { localId, fileName:file.name, fileSize:file.size, fileType:normType(file), processingMode, status:'pending' as const, createdAt:Date.now() }
    if(!isValid(file)){toast.error(`Unsupported: ${ALLOWED_EXTS.join(', ').toUpperCase()}`);return}
    if(file.size>maxBytes){toast.error(`Too large: ${formatFileSize(file.size)} / ${maxUploadMb} MB`);return}
    await upsertHistory(base); onActiveTaskChange(localId)
    onFileReady?.({id:localId,name:file.name,size:file.size,type:normType(file),file,uploadTime:new Date(),error:null,processingMode})
    try{
      const res = await uploadTask({file,processing_mode:processingMode})
      await upsertHistory({localId,taskId:String(res.task_id),status:'pending'})
      const poll = async () => {
        try{
          const r = await getTaskStatus(res.task_id); const st = toHistStatus(r.status)
          await upsertHistory({localId,taskId:String(res.task_id),status:st,currentStage:r.current_stage??r.current_step,progress:r.progress,executionTime:r.execution_time,totalPages:r.metadata?.total_pages,errorMessage:r.error_message,result:st==='completed'?r:undefined})
          if(st==='completed'||st==='failed')stopPoll(localId)
        }catch{stopPoll(localId)}
      }
      poll(); pollingRef.current.set(localId,setInterval(poll,POLL_MS))
    }catch(e:any){toast.error(e.response?.data?.message||e.message||'Upload failed')}
  }

  useEffect(()=>()=>{pollingRef.current.forEach(h=>clearInterval(h));pollingRef.current.clear()},[])

  useEffect(()=>{
    const onPaste = (e:ClipboardEvent)=>{
      if(e.defaultPrevented||(e.target instanceof HTMLElement&&(e.target.isContentEditable||['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName))))return
      const item=Array.from(e.clipboardData?.items??[]).find(i=>i.kind==='file'&&i.type.startsWith('image/'))
      if(!item)return;const f=item.getAsFile();if(!f)return;e.preventDefault()
      setPasteActive(true);setTimeout(()=>setPasteActive(false),900);void handleFile(f)
    }
    window.addEventListener('paste',onPaste);return ()=>window.removeEventListener('paste',onPaste)
  },[processingMode,maxBytes])

  const pendingCount = historyRecords.filter(r=>r.status==='pending'||r.status==='processing').length
  const showTimeline = activeRecord?.status==='pending'||activeRecord?.status==='processing'
  const stageIndex = resolveStage(activeRecord?.currentStage)

  return (
    <div className='flex flex-col flex-shrink-0 gap-0'>
      <div className='mode-toggle-shell'>
        <div className='mode-segmented' data-active={processingMode}>
          <span className='mode-segmented-thumb' />
          <button className='mode-segmented-btn' aria-pressed={processingMode==='pipeline'} onClick={()=>setMode('pipeline')}><FileText size={14}/> Docs</button>
          <button className='mode-segmented-btn' aria-pressed={processingMode==='formula'} onClick={()=>setMode('formula')}><Sigma size={14}/> Formula</button>
        </div>
      </div>

      <div className={cn('upload-compact',pasteActive&&'is-paste')}
        onDragOver={e=>e.preventDefault()}
        onDrop={e=>{e.preventDefault();Array.from(e.dataTransfer.files).forEach(f=>void handleFile(f))}}
        onClick={()=>fileInputRef.current?.click()}>
        <Upload size={16} className='upload-compact-icon'/>
        <div className='upload-compact-text'>
          <strong>Drop or click to upload</strong>
          <span>PDF / PNG · max {maxUploadMb} MB</span>
        </div>
        <span className='upload-compact-btn'>Browse</span>
        <input ref={fileInputRef} type='file' multiple className='hidden' accept='image/*,.pdf'
          onChange={e=>{Array.from(e.target.files??[]).forEach(f=>void handleFile(f));if(fileInputRef.current)fileInputRef.current.value=''}}/>
      </div>

      {pendingCount>0&&(
        <div className='flex items-center gap-2 mx-3 mt-2 px-3 py-2 rounded-md text-xs font-medium text-[var(--color-accent)] bg-[var(--color-accent-subtle)]'>
          <Loader2 size={14} className='animate-spin'/>{pendingCount} processing
        </div>
      )}

      {showTimeline&&activeRecord&&(
        <div className='mx-3 mt-2 p-3 rounded-md border border-[var(--color-border)] bg-white text-xs'>
          <div className='flex justify-between mb-2 text-[var(--color-text-muted)]'>
            <span>{activeRecord.currentStage||'Pending'}</span>
            <span>{Math.round(activeRecord.progress??0)}%</span>
          </div>
          <div className='task-card-progress mb-2'><div className='task-card-progress-bar' style={{width:`${Math.max(6,activeRecord.progress??stageIndex*28)}%`}}/></div>
          <div className='flex flex-col gap-1.5'>
            {STAGES.map((step,i)=>{
              const state=i<stageIndex?'done':i===stageIndex?'active':'idle'
              return (<div key={step.id} className='flex items-center gap-2'>
                <span className={cn('flex size-[16px] items-center justify-center rounded-full text-[9px]',state==='done'?'bg-emerald-500 text-white':state==='active'?'bg-[var(--color-accent)] text-white':'bg-[var(--color-bg-subtle)] text-[var(--color-text-muted)]')}>
                  {state==='done'?<Check size={10}/>:<span className='size-1 rounded-full bg-current'/>}
                </span>
                <span className={state==='idle'?'text-[var(--color-text-muted)]':'text-[var(--color-text-primary)] font-medium'}>{step.label}</span>
              </div>)
            })}
          </div>
        </div>
      )}
    </div>
  )
}
