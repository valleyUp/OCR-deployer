import { useEffect, useMemo, useState } from 'react'
import { FileText, Loader2, Search, Sigma, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/libs/utils'
import { formatDuration, formatRelativeTime, formatFileSize } from '@/libs/format'
import { useHistoryStore } from '@/store/useHistoryStore'
import type { HistoryRecord } from '@/libs/historyDb'

interface HistoryPanelProps { currentLocalId: string | null; onSelect: (record: HistoryRecord) => void }

function TaskCard({ record, active, onSelect, onDelete }: { record: HistoryRecord; active: boolean; onSelect: () => void; onDelete: () => void }) {
  const clickable = record.status === 'completed' || record.resultStripped
  const Icon = record.processingMode === 'formula' ? Sigma : FileText
  const statusClass = record.status === 'completed' ? 'done' : record.status === 'processing' ? 'processing' : record.status === 'failed' ? 'failed' : 'pending'
  const statusLabel = { pending: 'Pending', processing: 'Processing', completed: 'Done', failed: 'Failed', cancelled: 'Cancelled' }[record.status]
  const progressValue = Math.max(0, Math.min(100, record.progress ?? 0))

  const handleKey = (e: React.KeyboardEvent) => { if (!clickable) return; if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect() } }

  return (
    <div role='button' tabIndex={clickable ? 0 : -1} aria-disabled={!clickable}
      className={cn('task-card', `status-${statusClass}`, active && 'active')}
      onClick={() => clickable && onSelect()} onKeyDown={handleKey}
      style={{ animation: `fade-in 300ms var(--ease-out) both`, animationDelay: '0ms' }}>
      <div className='task-card-row'>
        <span className='task-card-icon' style={{ color: record.processingMode === 'formula' ? 'var(--color-accent)' : 'var(--color-text-secondary)' }}>
          <Icon size={16} />
        </span>
        <span className='task-card-name'>{record.fileName}</span>
      </div>
      <div className='task-card-meta'>
        <span className={cn('task-card-badge', statusClass)}>{statusClass === 'processing' && <Loader2 size={10} className='animate-spin' />}{statusLabel}</span>
        <span>{formatFileSize(record.fileSize)}</span>
        <span>·</span>
        <span>{record.status === 'completed' ? formatDuration(record.executionTime) : record.status === 'pending' || record.status === 'processing' ? '...' : formatRelativeTime(record.createdAt)}</span>
        <button className='ml-auto opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-[var(--color-error-bg)] text-[var(--color-text-muted)] hover:text-[var(--color-error)]'
          onClick={e => { e.stopPropagation(); onDelete() }} aria-label='Delete'><Trash2 size={12} /></button>
      </div>
      {record.status === 'processing' && (
        <div className='task-card-progress'><div className='task-card-progress-bar' style={{ width: `${progressValue}%` }} /></div>
      )}
    </div>
  )
}

export function HistoryPanel({ currentLocalId, onSelect }: HistoryPanelProps) {
  const records = useHistoryStore(s => s.records)
  const hydrate = useHistoryStore(s => s.hydrate)
  const clear = useHistoryStore(s => s.clear)
  const remove = useHistoryStore(s => s.remove)
  const loadResult = useHistoryStore(s => s.loadResult)
  const [confirmClear, setConfirmClear] = useState(false)
  const [query, setQuery] = useState('')

  useEffect(() => { void hydrate() }, [hydrate])

  const active = useMemo(() => records.find(r => r.localId === currentLocalId) ?? null, [records, currentLocalId])

  const filtered = useMemo(() => {
    if (!query) return records
    const q = query.toLowerCase()
    return records.filter(r => r.fileName.toLowerCase().includes(q))
  }, [records, query])

  const handleSelect = async (r: HistoryRecord) => {
    if (r.status !== 'completed' && !r.resultStripped) return
    if (!r.result && r.taskId) { const reloaded = await loadResult(r.localId); if (reloaded) { onSelect(reloaded); return } }
    onSelect(r)
  }

  return (
    <div className='history-section'>
      <div className='history-header'>
        <span className='history-title'>Recent Jobs</span>
        {records.length > 0 && (
          <button className='p-0.5 rounded text-[var(--color-text-muted)] hover:text-[var(--color-error)]' onClick={() => setConfirmClear(true)} aria-label='Clear all'><Trash2 size={14} /></button>
        )}
      </div>
      <div className='relative mx-3 mb-2 flex-shrink-0'>
        <Search size={12} className='absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] pointer-events-none' />
        <input type='text' value={query} onChange={e => setQuery(e.target.value)} placeholder='Search...'
          className='history-search pl-7 pr-7 w-full' />
        {query && <button onClick={() => setQuery('')} className='absolute right-2 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]'><X size={12} /></button>}
      </div>
      <div className='history-list group'>
        {filtered.length === 0 ? (
          <div className='flex flex-col items-center justify-center py-8 text-center text-xs text-[var(--color-text-muted)]'>
            <Search size={20} className='mb-2 opacity-40' />
            {query ? <p>No results for &ldquo;{query}&rdquo;</p> : <p>No history yet</p>}
          </div>
        ) : (
          filtered.map(r => (
            <TaskCard key={r.localId} record={r} active={active?.localId === r.localId}
              onSelect={() => void handleSelect(r)} onDelete={() => void remove(r.localId)} />
          ))
        )}
      </div>

      <Dialog open={confirmClear} onOpenChange={setConfirmClear}>
        <DialogContent className='sm:max-w-[380px]'>
          <DialogHeader><DialogTitle>Clear history?</DialogTitle><DialogDescription>Delete all {records.length} records. This cannot be undone.</DialogDescription></DialogHeader>
          <DialogFooter className='gap-2'>
            <Button variant='ghost' onClick={() => setConfirmClear(false)}>Cancel</Button>
            <Button className='bg-[var(--color-error)] hover:bg-red-700' onClick={async () => { await clear(); setConfirmClear(false) }}>Clear</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
