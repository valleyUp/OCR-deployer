import { useEffect, useMemo, useRef, useState } from 'react'
import {
	Check,
	Clock,
	FileText,
	Loader2,
	Sigma,
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

const MODE_OPTIONS: {
	id: ProcessingMode
	label: string
	hint: string
	icon: typeof FileText
}[] = [
	{ id: 'pipeline', label: '文档 OCR', hint: 'Markdown + bbox', icon: FileText },
	{ id: 'formula', label: '公式识别', hint: 'LaTeX / MML / UM', icon: Sigma }
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
		<div className='flex shrink-0 flex-col bg-card'>
			<div className='flex flex-col gap-4 p-6'>
				<div>
					<h2 className='text-[20px] font-medium tracking-tight text-foreground'
						style={{ fontFamily: 'var(--font-display)', letterSpacing: '-0.025em' }}>
						文件上传
					</h2>
					<p className='mt-0.5 text-[12px] text-muted-foreground'>
						拖拽、点击或粘贴；支持多选
					</p>
				</div>

				<div className='rounded-lg bg-secondary p-1'>
					<div className='grid grid-cols-2 gap-1.5'>
						{MODE_OPTIONS.map(option => {
							const active = processingMode === option.id
							const Icon = option.icon
							return (
								<button
									key={option.id}
									type='button'
									aria-pressed={active}
									onClick={() => setProcessingMode(option.id)}
									className={cn(
										'flex flex-col items-center gap-0.5 rounded-lg px-2 py-2 transition-all duration-150',
										active
											? 'bg-card text-foreground shadow-sm ring-1 ring-border'
											: 'text-muted-foreground hover:text-foreground'
									)}>
									<span className='flex items-center gap-1.5 text-[13px] font-medium'>
										<Icon className='size-4' />
										{option.label}
									</span>
									<span className='text-[10px] text-muted-foreground/80'>
										{option.hint}
									</span>
								</button>
							)
						})}
					</div>
				</div>

				<div
					className={cn(
						'relative cursor-pointer rounded-xl border-2 border-dashed px-4 py-8 text-center transition-all duration-260',
						isDragging
							? 'scale-[1.01] border-primary bg-accent'
							: 'border-border hover:border-primary/50 hover:bg-card'
					)}
					style={{ borderColor: isDragging ? 'var(--primary)' : undefined }}
					onDragOver={handleDragOver}
					onDragLeave={handleDragLeave}
					onDrop={handleDrop}
					onClick={() => fileInputRef.current?.click()}>
					<div className='flex flex-col items-center gap-2.5'>
						<span
							className={cn(
								'flex size-11 items-center justify-center rounded-full transition-all duration-260',
								isDragging
									? 'bg-accent text-primary'
									: 'bg-secondary text-muted-foreground'
							)}>
							<UploadCloud
								className={cn(
									'size-5 transition-transform duration-260',
									isDragging && 'motion-safe:animate-bounce'
								)}
							/>
						</span>
						<p className='text-[16px] font-medium text-foreground'
							style={{ fontFamily: 'var(--font-display)', letterSpacing: '-0.015em' }}>
							{isDragging ? '松手上传文件' : '点击或拖拽到此处'}
						</p>
						<p className='flex items-center justify-center gap-1 text-[11.5px] text-muted-foreground'>
							或按 <kbd>⌘</kbd>
							<span className='text-muted-foreground/70'>/</span>
							<kbd>Ctrl</kbd>
							<kbd>V</kbd> 粘贴图片
						</p>
						<p className='text-[10.5px] text-muted-foreground/80'>
							PNG · JPG · PDF · 最大 {maxUploadMb} MB · 支持多选
						</p>
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
					<p className='text-[11px] text-muted-foreground'>
						{pendingCount} 个任务处理中
						<Loader2 className='ml-1 inline size-3 dot-pulse align-[-2px]' />
					</p>
				)}
			</div>

			{showTimeline && activeRecord && (
				<div className='mx-4 mb-4 rounded-lg border border-border bg-card p-4'>
					<div className='mb-3 flex items-center gap-1.5 text-[10.5px] font-medium uppercase tracking-widest text-muted-foreground'
						style={{ fontFamily: 'var(--font-mono)' }}>
						<Clock className='size-3.5' />
						{activeRecord.currentStage || '排队中'}
					</div>
					<ol className='space-y-2.5 relative before:absolute before:left-[7px] before:top-1 before:bottom-1 before:w-px before:bg-border'>
						{STAGE_STEPS.map((step, index) => {
							const state =
								index < stageIndex
									? 'done'
									: index === stageIndex
										? 'active'
										: 'idle'
							return (
								<li key={step.id} className='flex items-center gap-2.5 relative z-1'>
									<span
										className={cn(
											'flex size-[14px] items-center justify-center rounded-full transition-all duration-260',
											state === 'done' && 'bg-primary text-primary-foreground',
											state === 'active' &&
												'bg-primary text-primary-foreground step-pulse',
											state === 'idle' && 'bg-secondary text-muted-foreground'
										)}>
										{state === 'done' ? (
											<Check className='size-2.5' />
										) : (
											<span className='size-1.5 rounded-full bg-current' />
										)}
									</span>
									<span
										className={cn(
											'text-[12.5px]',
											state === 'idle' ? 'text-muted-foreground' : 'text-foreground font-medium'
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
