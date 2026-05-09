import { useEffect, useMemo, useState } from 'react'
import {
	AlertCircle,
	Check,
	ClipboardCopy,
	Clock,
	FileText,
	History,
	Loader2,
	Sigma,
	Trash2
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
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
import { formatDuration, formatFileSize, formatRelativeTime } from '@/libs/format'
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

function StatusBadge({ status }: { status: HistoryRecord['status'] }) {
	const isActive = status === 'processing' || status === 'pending'
	const tone: Record<HistoryRecord['status'], string> = {
		pending: 'bg-slate-100 text-slate-600',
		processing: 'bg-blue-50 text-blue-700',
		completed: 'bg-emerald-50 text-emerald-700',
		failed: 'bg-red-50 text-red-700',
		cancelled: 'bg-slate-100 text-slate-500'
	}
	const Icon =
		status === 'completed'
			? Check
			: status === 'failed'
				? AlertCircle
				: status === 'processing'
					? Loader2
					: Clock
	return (
		<span
			className={cn(
				'inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold',
				tone[status]
			)}>
			<Icon
				className={cn(
					'size-2.5',
					status === 'processing' && 'animate-spin',
					isActive && 'motion-safe:animate-pulse'
				)}
			/>
			{STATUS_LABEL[status]}
		</span>
	)
}

function HistoryItem({
	record,
	active,
	onSelect,
	onDelete
}: {
	record: HistoryRecord
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
			data-active={active ? 'true' : 'false'}
			className={cn(
				'ocr-history-item group relative mx-3 mb-2 block rounded-2xl px-3 py-3 text-left',
				clickable && 'cursor-pointer',
				!clickable && 'cursor-default opacity-70'
			)}>
			<div className='flex items-start gap-2'>
				<span
					className={cn(
						'mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-xl',
						record.processingMode === 'formula'
							? 'bg-violet-100 text-violet-600'
							: 'bg-blue-100 text-blue-600'
					)}>
					<Icon className='size-4' />
				</span>
				<div className='min-w-0 flex-1'>
					<div className='flex items-center gap-1.5'>
						<p className='truncate text-[12px] font-semibold text-slate-950'>
							{record.fileName}
						</p>
						<Badge
							variant='outline'
							className='h-4 shrink-0 rounded-full border-white/70 bg-white/70 px-1.5 text-[9px] font-medium text-slate-500'>
							{MODE_LABEL[record.processingMode]}
						</Badge>
					</div>
					<div className='mt-1 flex flex-wrap items-center gap-1.5 text-[10.5px] text-slate-500'>
						<StatusBadge status={record.status} />
						<span>{formatFileSize(record.fileSize)}</span>
						<span>·</span>
						<span>
							{record.status === 'completed'
								? formatDuration(record.executionTime)
								: record.status === 'pending' || record.status === 'processing'
									? '处理中…'
									: formatRelativeTime(record.createdAt)}
						</span>
					</div>
					{record.status === 'processing' && (
						<div className='mt-2'>
							<div className='h-1.5 overflow-hidden rounded-full bg-slate-200/80'>
								<div
									className='h-full rounded-full bg-gradient-to-r from-blue-600 via-cyan-500 to-emerald-400 transition-[width] duration-300 ease-out'
									style={{ width: `${progressValue}%` }}
								/>
							</div>
							{record.currentStage && (
								<p className='mt-1 truncate text-[10px] text-slate-500'>
									{record.currentStage}
								</p>
							)}
						</div>
					)}
					{record.status === 'failed' && record.errorMessage && (
						<p className='mt-1 line-clamp-2 break-all text-[10px] text-red-600'>
							{record.errorMessage}
						</p>
					)}
					<div className='mt-1.5 flex items-center gap-1'>
						{record.taskId && (
							<button
								type='button'
								onClick={handleCopyTaskId}
								aria-label='复制任务 ID'
								className={cn(
									'inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 font-mono text-[9.5px] text-slate-500 transition-colors hover:bg-white hover:text-slate-900'
								)}>
								{idCopied ? (
									<Check className='size-2.5' />
								) : (
									<ClipboardCopy className='size-2.5' />
								)}
								<span className='max-w-[7rem] truncate'>{record.taskId}</span>
							</button>
						)}
						<button
							type='button'
							onClick={handleDelete}
							aria-label='删除记录'
							className='ml-auto inline-flex size-6 items-center justify-center rounded-full text-slate-400 opacity-0 transition-colors hover:bg-red-50 hover:text-red-600 group-hover:opacity-100 focus-visible:opacity-100'>
							<Trash2 className='size-3' />
						</button>
					</div>
				</div>
			</div>
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

	useEffect(() => {
		void hydrate()
	}, [hydrate])

	const active = useMemo(
		() => records.find(r => r.localId === currentLocalId) ?? null,
		[records, currentLocalId]
	)

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
		<div className='flex min-h-0 flex-1 flex-col border-t border-white/70'>
			<div className='ocr-panel-toolbar flex items-center justify-between gap-2 px-4 py-3'>
				<div className='flex flex-1 items-center gap-1.5 text-[12px] font-semibold tracking-tight text-slate-900'>
					<History className='size-3.5 text-slate-500' />
					历史记录
					<Badge
						variant='outline'
						className='h-4 rounded-full border-white/70 bg-white/70 px-1.5 text-[10px] font-medium text-slate-500'>
						{records.length}
					</Badge>
				</div>
				{records.length > 0 && (
					<Button
						variant='ghost'
						size='icon-sm'
						aria-label='清空历史'
						className='ocr-icon-button size-8 text-slate-400 hover:text-red-600'
						onClick={() => setConfirmClear(true)}>
						<Trash2 className='size-3.5' />
					</Button>
				)}
			</div>

			<div className='ocr-scrollbar flex-1 overflow-auto py-3'>
				{records.length === 0 ? (
					<div className='mx-4 flex h-full min-h-[8rem] flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white/50 px-4 py-6 text-center'>
						<span className='mb-2 flex size-10 items-center justify-center rounded-2xl bg-slate-100 text-slate-400'>
							<History className='size-5' />
						</span>
						<p className='text-[12px] font-medium text-slate-600'>还没有识别任务</p>
					</div>
				) : (
					records.map(record => (
						<HistoryItem
							key={record.localId}
							record={record}
							active={active?.localId === record.localId}
							onSelect={() => void handleSelect(record)}
							onDelete={() => void remove(record.localId)}
						/>
					))
				)}
			</div>

			<Dialog open={confirmClear} onOpenChange={setConfirmClear}>
				<DialogContent className='sm:max-w-[380px]'>
					<DialogHeader>
						<DialogTitle>清空历史？</DialogTitle>
						<DialogDescription>
							将删除全部 {records.length} 条本地历史记录，无法撤销。
						</DialogDescription>
					</DialogHeader>
					<DialogFooter className='gap-2'>
						<Button variant='ghost' onClick={() => setConfirmClear(false)}>
							取消
						</Button>
						<Button
							variant='destructive'
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
