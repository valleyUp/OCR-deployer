import { useEffect, useMemo, useRef, useState } from 'react'
import {
	Check,
	Loader2,
	UploadCloud
} from 'lucide-react'
import { cn } from '@/libs/utils'
import {
	getTaskStatus,
	uploadTask,
	type TaskStatus,
	type TaskStatusData
} from '@/libs/api'
import { toast } from 'sonner'
import { useHistoryStore } from '@/store/useHistoryStore'
import { useConfigStore } from '@/store/useConfigStore'
import { formatFileSize } from '@/libs/format'
import type { HistoryRecord } from '@/libs/historyDb'

export type Layout = {
	block_content: string
	bbox: [number, number, number, number] | null
	block_id: number
	text_length?: number | null
}

export interface UploadedFile {
	id: string
	name: string
	size: number
	type: string
	file: File
	uploadTime: Date
	error: string | null
	processingMode: ProcessingMode
}

export interface TaskResponse {
	fileId: string
	status: TaskStatus
	response: TaskStatusData | null
	error_message?: string | null
}

interface FileUploadProps {
	currentLocalId: string | null
	onActiveTaskChange: (localId: string | null) => void
	onFileReady?: (uploadedFile: UploadedFile) => void
}

const ALLOWED_FILE_TYPES = [
	'image/png',
	'image/jpeg',
	'image/jpg',
	'application/pdf'
]
const ALLOWED_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.pdf']
type ProcessingMode = 'pipeline' | 'formula'
const CLIPBOARD_IMAGE_PREFIX = 'clipboard-image'
const POLL_INTERVAL_MS = 2000

const STAGE_STEPS: { id: string; label: string; matchers: string[] }[] = [
	{ id: 'upload', label: '上传', matchers: ['upload', 'queued', 'pending'] },
	{ id: 'pdf_to_image', label: '读取文件', matchers: ['pdf_to_image', 'image'] },
	{
		id: 'layout_and_ocr',
		label: '识别与版面',
		matchers: ['layout_and_ocr', 'layout', 'ocr', 'recogniz']
	},
	{
		id: 'result_merge',
		label: '整理结果',
		matchers: ['result_merge', 'merge', 'render', 'finaliz']
	}
]

const MODE_OPTIONS: { id: ProcessingMode; label: string; hint: string }[] = [
	{ id: 'pipeline', label: '文档 OCR', hint: 'pipeline' },
	{ id: 'formula', label: '公式识别', hint: 'formula only' }
]

const inferMimeTypeByName = (name: string): string => {
	const lower = name.toLowerCase()
	if (lower.endsWith('.pdf')) return 'application/pdf'
	if (lower.endsWith('.png')) return 'image/png'
	if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
	return ''
}

const normalizeFileType = (file: File): string =>
	file.type || inferMimeTypeByName(file.name)

const getFileExtensionByMimeType = (mime: string): string => {
	switch (mime) {
		case 'image/jpeg':
			return 'jpg'
		case 'image/webp':
			return 'webp'
		default:
			return 'png'
	}
}

const createClipboardImageFile = (file: File): File => {
	if (file.name) return file
	const normalizedType = normalizeFileType(file) || 'image/png'
	const extension = getFileExtensionByMimeType(normalizedType)
	const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
	return new File(
		[file],
		`${CLIPBOARD_IMAGE_PREFIX}-${timestamp}.${extension}`,
		{ type: normalizedType, lastModified: Date.now() }
	)
}

const isEditablePasteTarget = (target: EventTarget | null): boolean => {
	if (!(target instanceof HTMLElement)) return false
	if (target.isContentEditable) return true
	return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}

const isValidFileType = (file: File): boolean => {
	const normalized = normalizeFileType(file)
	if (ALLOWED_FILE_TYPES.includes(normalized)) return true
	const fileName = file.name.toLowerCase()
	return ALLOWED_EXTENSIONS.some(ext => fileName.endsWith(ext))
}

const resolveStageIndex = (stage?: string | null): number => {
	if (!stage) return 0
	const lower = stage.toLowerCase()
	for (let i = STAGE_STEPS.length - 1; i >= 0; i--) {
		if (STAGE_STEPS[i].matchers.some(token => lower.includes(token))) {
			return i
		}
	}
	return 0
}

function generateLocalId(): string {
	if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
		return crypto.randomUUID()
	}
	return `u-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function taskStatusToHistory(status: TaskStatus): HistoryRecord['status'] {
	if (status === 'pending') return 'pending'
	if (status === 'processing') return 'processing'
	if (status === 'completed') return 'completed'
	return 'failed'
}

export function FileUpload({
	currentLocalId,
	onActiveTaskChange,
	onFileReady
}: FileUploadProps) {
	const upsertHistory = useHistoryStore(s => s.upsert)
	const historyRecords = useHistoryStore(s => s.records)
	const maxUploadMb = useConfigStore(s => s.maxUploadMb)

	const [isDragging, setIsDragging] = useState(false)
	const [processingMode, setProcessingMode] =
		useState<ProcessingMode>('pipeline')
	const [pasteActive, setPasteActive] = useState(false)

	const fileInputRef = useRef<HTMLInputElement>(null)
	const pollingIntervalsRef = useRef<Map<string, ReturnType<typeof setInterval>>>(
		new Map()
	)

	const activeRecord = useMemo(
		() => historyRecords.find(r => r.localId === currentLocalId) ?? null,
		[historyRecords, currentLocalId]
	)

	const maxUploadBytes = useMemo(
		() => Math.max(1, maxUploadMb) * 1024 * 1024,
		[maxUploadMb]
	)

	const stopPolling = (localId: string) => {
		const handle = pollingIntervalsRef.current.get(localId)
		if (handle) {
			clearInterval(handle)
			pollingIntervalsRef.current.delete(localId)
		}
	}

	const pollOnce = async (localId: string, taskId: string | number) => {
		try {
			const response = await getTaskStatus(taskId)
			const status = taskStatusToHistory(response.status)
			const stage = response.current_stage ?? response.current_step ?? undefined
			const progress = response.progress ?? undefined
			const executionTime = response.execution_time
			const totalPages = response.metadata?.total_pages
			await upsertHistory({
				localId,
				taskId,
				status,
				currentStage: stage,
				progress,
				startedAt:
					status === 'processing' || status === 'completed' || status === 'failed'
						? Date.now()
						: undefined,
				completedAt:
					status === 'completed' || status === 'failed' ? Date.now() : undefined,
				executionTime,
				totalPages,
				errorMessage: response.error_message ?? null,
				result: status === 'completed' ? response : null
			})
			if (status === 'completed' || status === 'failed') {
				stopPolling(localId)
			}
		} catch (error) {
			console.error('[upload] polling failed:', error)
			stopPolling(localId)
		}
	}

	const startPolling = (localId: string, taskId: string | number) => {
		stopPolling(localId)
		void pollOnce(localId, taskId)
		const handle = setInterval(
			() => void pollOnce(localId, taskId),
			POLL_INTERVAL_MS
		)
		pollingIntervalsRef.current.set(localId, handle)
	}

	const handleFile = async (file: File) => {
		const localId = generateLocalId()
		const baseRecord: Partial<HistoryRecord> & { localId: string } = {
			localId,
			fileName: file.name,
			fileSize: file.size,
			fileType: normalizeFileType(file),
			processingMode,
			status: 'pending',
			createdAt: Date.now()
		}

		if (!isValidFileType(file)) {
			const msg = `不支持的格式：${ALLOWED_EXTENSIONS.join(', ').toUpperCase()}`
			toast.error(msg)
			await upsertHistory({
				...baseRecord,
				status: 'failed',
				errorMessage: msg,
				completedAt: Date.now()
			})
			return
		}
		if (file.size > maxUploadBytes) {
			const msg = `文件过大：${formatFileSize(file.size)} / 上限 ${maxUploadMb} MB`
			toast.error(msg)
			await upsertHistory({
				...baseRecord,
				status: 'failed',
				errorMessage: msg,
				completedAt: Date.now()
			})
			return
		}

		await upsertHistory(baseRecord)
		onActiveTaskChange(localId)

		const now = new Date()
		onFileReady?.({
			id: localId,
			name: file.name,
			size: file.size,
			type: normalizeFileType(file),
			file,
			uploadTime: now,
			error: null,
			processingMode
		})

		try {
			const response = await uploadTask({
				file,
				custom_url: undefined,
				processing_mode: processingMode
			})
			const taskId = String(response.task_id)
			await upsertHistory({ localId, taskId, status: 'pending' })
			startPolling(localId, taskId)
		} catch (error: any) {
			const errorMessage =
				error.response?.data?.message || error.message || '文件上传失败'
			toast.error(errorMessage)
			await upsertHistory({
				localId,
				status: 'failed',
				errorMessage,
				completedAt: Date.now()
			})
		}
	}

	const handleDragOver = (event: React.DragEvent) => {
		event.preventDefault()
		setIsDragging(true)
	}
	const handleDragLeave = (event: React.DragEvent) => {
		event.preventDefault()
		setIsDragging(false)
	}
	const handleDrop = (event: React.DragEvent) => {
		event.preventDefault()
		setIsDragging(false)
		const files = Array.from(event.dataTransfer.files)
		if (files.length === 0) return
		files.forEach(file => void handleFile(file))
	}

	const handleFileInput = (event: React.ChangeEvent<HTMLInputElement>) => {
		const files = event.target.files
		if (!files || files.length === 0) return
		Array.from(files).forEach(file => void handleFile(file))
		if (fileInputRef.current) fileInputRef.current.value = ''
	}

	useEffect(() => {
		const intervals = pollingIntervalsRef.current
		return () => {
			intervals.forEach(handle => clearInterval(handle))
			intervals.clear()
		}
	}, [])

	useEffect(() => {
		const handlePaste = (event: ClipboardEvent) => {
			if (event.defaultPrevented || isEditablePasteTarget(event.target)) return
			const items = Array.from(event.clipboardData?.items ?? [])
			const image = items.find(
				item => item.kind === 'file' && item.type.startsWith('image/')
			)
			if (!image) return
			const file = image.getAsFile()
			if (!file) return
			event.preventDefault()
			setPasteActive(true)
			window.setTimeout(() => setPasteActive(false), 900)
			void handleFile(createClipboardImageFile(file))
		}
		window.addEventListener('paste', handlePaste)
		return () => window.removeEventListener('paste', handlePaste)
	}, [processingMode, maxUploadBytes, maxUploadMb])

	const showTimeline =
		activeRecord?.status === 'pending' || activeRecord?.status === 'processing'
	const stageIndex = resolveStageIndex(activeRecord?.currentStage)
	const pendingCount = historyRecords.filter(
		r => r.status === 'pending' || r.status === 'processing'
	).length

	return (
		<div className='flex shrink-0 flex-col'>
			<div className='flex flex-col gap-4 p-5'>


				{/* Mode Switch — Scheme B card + sliding thumb */}
				<div className='card mode-card'>
					<p className='section-title'>processing mode</p>
					<div className='mode-switch' data-mode={processingMode}>
						<span className='mode-thumb' aria-hidden='true' />
						{MODE_OPTIONS.map(option => {
							const active = processingMode === option.id
							return (
								<button
									key={option.id}
									type='button'
									aria-pressed={active}
									onClick={() => setProcessingMode(option.id)}
									className='mode-button interactive'>
									<strong>{option.label}</strong>
									<span>{option.hint}</span>
								</button>
							)
						})}
					</div>
				</div>

				{/* Upload Zone */}
				<div
					className={cn('upload-zone interactive', pasteActive && 'is-paste')}
					onDragOver={handleDragOver}
					onDragLeave={handleDragLeave}
					onDrop={handleDrop}
					onClick={() => fileInputRef.current?.click()}>
					<div>
						<div className='upload-icon'>
							<UploadCloud className='size-6' />
						</div>
						<p className='upload-title' style={{ fontSize: '18px' }}>
							{isDragging ? '松手上传' : '新建任务'}
						</p>
						<p className='upload-copy'>
							点击上传或拖拽文件到此处，也可以在任意位置 <kbd className='font-mono rounded border bg-[rgba(0,0,0,0.04)] px-1 text-[10px]'>Ctrl+V</kbd> 粘贴
						</p>
						<div className='chips'>
							<span className='mono-chip'>PNG</span>
							<span className='mono-chip'>PDF</span>
							<span className='mono-chip'>clipboard</span>
						</div>
					</div>
				</div>

				<input
					ref={fileInputRef}
					type='file'
					multiple
					className='hidden'
					accept='image/*,.pdf'
					onChange={handleFileInput}
				/>

				{pendingCount > 0 && (
					<div className='flex items-center justify-between rounded-lg border border-[rgba(37,99,235,0.18)] bg-[rgba(37,99,235,0.06)] px-3 py-2 text-[12px] font-medium text-[#2563EB]'>
						<span>{pendingCount} 个任务处理中</span>
						<Loader2 className='size-3.5 animate-spin' />
					</div>
				)}
			</div>

			{/* Pipeline timeline */}
			{showTimeline && activeRecord && (
				<div className='mx-5 mb-5 rounded-xl border border-[rgba(38,35,29,0.10)] bg-white/80 p-4 shadow-sm'>
					<div className='mb-3 flex items-center justify-between'>
						<span className='flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-[#9A9286]'>
							<span className='size-1.5 rounded-full bg-[#2563EB] shadow-[0_0_0_3px_rgba(37,99,235,0.2)]' />
							{activeRecord.currentStage || '排队中'}
						</span>
						<span className='text-[11px] font-medium tabular-nums text-[#9A9286]'>
							{Math.round(activeRecord.progress ?? 0)}%
						</span>
					</div>
					<div className='progress-track mb-3'>
						<div
							className='progress-bar'
							style={{ width: `${Math.max(6, activeRecord.progress ?? stageIndex * 28)}%` }}
						/>
					</div>
					<ol className='space-y-2.5'>
						{STAGE_STEPS.map((step, index) => {
							const state =
								index < stageIndex
									? 'done'
									: index === stageIndex
										? 'active'
										: 'idle'
							return (
								<li key={step.id} className='flex items-center gap-2.5'>
									<span
										className={cn(
											'flex size-[18px] items-center justify-center rounded-full text-[10px] transition-all duration-300',
											state === 'done' &&
												'bg-emerald-500 text-white',
											state === 'active' &&
												'bg-[#2563EB] text-white shadow-[0_0_0_4px_rgba(37,99,235,0.16)]',
											state === 'idle' &&
												'bg-[rgba(38,35,29,0.08)] text-[#9A9286]'
										)}
										style={
											state === 'active'
												? { animation: 'pulseGlow 2s ease-in-out infinite' }
												: undefined
										}>
										{state === 'done' ? (
											<Check className='size-2.5' />
										) : (
											<span className='size-1.5 rounded-full bg-current' />
										)}
									</span>
									<span
										className={cn(
											'text-[12.5px] transition-colors duration-300',
											state === 'idle'
												? 'text-[#9A9286]'
												: 'text-[#26231D] font-medium'
										)}>
										{step.label}
									</span>
								</li>
							)
						})}
					</ol>
				</div>
			)}
		</div>
	)
}
