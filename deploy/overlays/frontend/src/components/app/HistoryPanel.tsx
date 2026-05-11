import { useEffect, useMemo, useState } from 'react'
import {
	Check,
	ClipboardCopy,
	FileText,
	History,
	Loader2,
	Sigma,
	Trash2,
	Search,
	X
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle
} from '@/components/ui/dialog'
import { cn } from '@/libs/utils'
import { formatDuration, formatRelativeTime, formatFileSize } from '@/libs/format'
import { useHistoryStore } from '@/store/useHistoryStore'
import type { HistoryRecord } from '@/libs/historyDb'
import { toast } from 'sonner'

interface HistoryPanelProps {
	currentLocalId: string | null
	onSelect: (record: HistoryRecord) => void
}

const STATUS_LABEL: Record<HistoryRecord['status'], string> = {
	pending: '排队中',
	processing: '识别中',
	completed: '已完成',
	failed: '失败',
	cancelled: '已取消'
}

const MODE_LABEL: Record<HistoryRecord['processingMode'], string> = {
	pipeline: '文档',
	formula: '公式'
}

function StatusPill({ status }: { status: HistoryRecord['status'] }) {
	const base = 'status-pill'
	const tone =
		status === 'completed' ? 'status-ok' :
		status === 'failed' ? 'status-warn' :
		'status-info'

	return (
		<span className={cn(base, tone)}>
			{status === 'processing' ? (
				<Loader2 className='size-2.5 animate-spin' />
			) : (
				<span className='dot opacity-100' />
			)}
			{STATUS_LABEL[status]}
		</span>
	)
}

function HistoryItem({
	record,
	index,
	active,
	onSelect,
	onDelete
}: {
	record: HistoryRecord
	index: number
	active: boolean
	onSelect: () => void
	onDelete: () => void
}) {
	const [idCopied, setIdCopied] = useState(false)

	const handleCopyTaskId = async (event: React.MouseEvent) => {
		event.stopPropagation()
		if (!record.taskId) return
		try {
			await navigator.clipboard.writeText(String(record.taskId))
			setIdCopied(true)
			toast.success('已复制 task ID')
			window.setTimeout(() => setIdCopied(false), 1200)
		} catch {
			toast.error('复制失败')
		}
	}

	const handleDelete = (event: React.MouseEvent) => {
		event.stopPropagation()
		onDelete()
	}

	const progressValue = Math.max(0, Math.min(100, record.progress ?? 0))
	const clickable = record.status === 'completed' || record.resultStripped
	const icon = record.processingMode === 'formula' ? Sigma : FileText
	const Icon = icon

	return (
		<div
			role='button'
			tabIndex={clickable ? 0 : -1}
			onClick={() => {
				if (clickable) onSelect()
			}}
			onKeyDown={event => {
				if (!clickable) return
				if (event.key === 'Enter' || event.key === ' ') {
					event.preventDefault()
					onSelect()
				}
			}}
			aria-disabled={!clickable}
			className={cn('job-row scroll-row', active && 'active')}
			style={{
				animation: `fadeSlideUp 340ms var(--expo-out) both`,
				animationDelay: `${index * 45}ms`
			}}>
			<span
				className={cn(
					'icon-wrap shrink-0',
					record.processingMode === 'formula' ? 'icon-info' : 'icon-primary'
				)}>
				<Icon className='size-4' />
			</span>
			<span className='job-main'>
				<span className='job-name'>{record.fileName}</span>
				<span className='job-meta'>
					{MODE_LABEL[record.processingMode]} · {formatFileSize(record.fileSize)} ·{' '}
					{record.status === 'completed'
						? formatDuration(record.executionTime)
						: record.status === 'pending' || record.status === 'processing'
							? '处理中…'
							: formatRelativeTime(record.createdAt)}
				</span>
				{record.status === 'processing' && (
					<div className='mt-2'>
						<div className='progress-track'>
							<div
								className='progress-bar'
								style={{ width: `${progressValue}%` }}
							/>
						</div>
						{record.currentStage && (
							<p className='mt-1 text-[10px] text-[#9A9286]'>
								{record.currentStage}
							</p>
						)}
					</div>
				)}
				{record.status === 'failed' && record.errorMessage && (
					<p className='mt-1 line-clamp-2 break-all text-[10px] text-[#B91C1C]'>
						{record.errorMessage}
					</p>
				)}
			</span>
			<span className='flex items-center gap-2'>
				<StatusPill status={record.status} />
				{record.taskId && (
					<button
						type='button'
						onClick={handleCopyTaskId}
						aria-label='复制任务 ID'
						className='inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 font-mono text-[10px] text-[#9A9286] transition-colors hover:bg-white hover:text-[#26231D]'>
						{idCopied ? (
							<Check className='size-2.5' />
						) : (
							<ClipboardCopy className='size-2.5' />
						)}
					</button>
				)}
				<button
					type='button'
					onClick={handleDelete}
					aria-label='删除记录'
					className='inline-flex size-6 items-center justify-center rounded-full text-[#9A9286] transition-all duration-200 hover:bg-[rgba(185,28,28,0.10)] hover:text-[#B91C1C]'>
					<Trash2 className='size-3' />
				</button>
			</span>
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

	useEffect(() => {
		void hydrate()
	}, [hydrate])

	const active = useMemo(
		() => records.find(r => r.localId === currentLocalId) ?? null,
		[records, currentLocalId]
	)

	const filteredRecords = useMemo(() => {
		if (!query) return records
		const lower = query.toLowerCase()
		return records.filter(r => r.fileName.toLowerCase().includes(lower))
	}, [records, query])

	const handleSelect = async (record: HistoryRecord) => {
		if (record.status !== 'completed' && !record.resultStripped) return
		if (!record.result && record.taskId) {
			const reloaded = await loadResult(record.localId)
			if (reloaded) {
				onSelect(reloaded)
				return
			}
		}
		onSelect(record)
	}

	return (
		<div className='flex min-h-0 flex-1 flex-col'>
			<div className='flex flex-col gap-2 px-4 py-2 border-t border-[rgba(0,0,0,0.06)] bg-white/50'>
				<div className='flex items-center justify-between'>
					<p className='section-title m-0'>recent jobs</p>
					{records.length > 0 && (
						<button
							aria-label='清空历史'
							className='btn-icon size-6 text-[#9A9286] hover:text-[#B91C1C] rounded-md'
							onClick={() => setConfirmClear(true)}>
							<Trash2 className='size-3.5' />
						</button>
					)}
				</div>
				<div className='relative'>
					<Search className='pointer-events-none absolute left-2.5 top-1/2 size-3 -translate-y-1/2 text-[#8e8e96]' />
					<input
						type='text'
						value={query}
						placeholder='搜索任务记录'
						onChange={event => setQuery(event.target.value)}
						className='h-7 w-full rounded-md border border-[rgba(0,0,0,0.08)] bg-white/80 pl-7 pr-6 text-[11px] text-[#0d0d12] shadow-inner outline-none transition-colors duration-150 placeholder:text-[#8e8e96] focus-visible:border-blue-400'
					/>
					{query && (
						<button
							type='button'
							aria-label='清空搜索'
							onClick={() => setQuery('')}
							className='absolute right-1.5 top-1/2 flex size-4 -translate-y-1/2 items-center justify-center rounded-full text-[#8e8e96] hover:bg-[rgba(0,0,0,0.04)] hover:text-[#0d0d12]'>
							<X className='size-2.5' />
						</button>
					)}
				</div>
			</div>

			{/* Job list */}
			<div className='queue sb-accent scrollbar-thin flex-1 overflow-auto px-3 pb-4'>
				{filteredRecords.length === 0 ? (
					<div className='flex min-h-[8rem] flex-col items-center justify-center rounded-xl border border-dashed border-[rgba(38,35,29,0.10)] bg-[rgba(255,255,255,0.4)] px-4 py-8 text-center'>
						<span className='mb-2 flex size-10 items-center justify-center rounded-xl bg-[rgba(38,35,29,0.04)] text-[#9A9286]'>
							<History className='size-5' />
						</span>
						<p className='text-[12px] font-medium text-[#6F685D]'>暂无记录</p>
					</div>
				) : (
					<div className='mt-2 space-y-1.5'>
						{filteredRecords.map((record, index) => (
							<HistoryItem
								key={record.localId}
								record={record}
								index={index}
								active={active?.localId === record.localId}
								onSelect={() => void handleSelect(record)}
								onDelete={() => void remove(record.localId)}
							/>
						))}
					</div>
				)}
			</div>

			<Dialog open={confirmClear} onOpenChange={setConfirmClear}>
				<DialogContent className='sm:max-w-[380px]'>
					<DialogHeader>
						<DialogTitle className='font-[family-name:var(--f-display)]'>清空历史？</DialogTitle>
						<DialogDescription>
							将删除全部 {records.length} 条本地历史记录，无法撤销。
						</DialogDescription>
					</DialogHeader>
					<DialogFooter className='gap-2'>
						<Button variant='ghost' onClick={() => setConfirmClear(false)}>
							取消
						</Button>
						<Button
							className='bg-[#B91C1C] hover:bg-[#DC2626]'
							onClick={async () => {
								await clear()
								setConfirmClear(false)
							}}>
							清空
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	)
}
