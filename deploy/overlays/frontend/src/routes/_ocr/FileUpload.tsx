import { useState, useRef, useEffect } from 'react'
import {
	Check,
	ClipboardCopy,
	Clock,
	FileText,
	Loader2,
	Sigma,
	UploadCloud
} from 'lucide-react'
import { cn } from '@/libs/utils'
import { Badge } from '@/components/ui/badge'
import {
	uploadTask,
	getTaskStatus,
	type TaskStatus,
	type TaskStatusData
} from '@/libs/api'
import { toast } from 'sonner'

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
	onFileUploaded: (params: UploadedFile) => void
	onTaskStatusChange?: (params: TaskResponse) => void
}

const ALLOWED_FILE_TYPES = [
	'image/png',
	'image/jpeg',
	'image/jpg',
	'application/pdf'
]
const ALLOWED_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.pdf']
const MAX_FILE_SIZE = 20 * 1024 * 1024 // 20MB in bytes
type ProcessingMode = 'pipeline' | 'formula'
const CLIPBOARD_IMAGE_PREFIX = 'clipboard-image'

const STAGE_STEPS: { id: string; label: string; matchers: string[] }[] = [
	{ id: 'upload', label: '上传', matchers: ['upload', 'queued', 'pending'] },
	{ id: 'layout', label: '版面分析', matchers: ['layout', 'detect', 'parse', 'page'] },
	{ id: 'recognize', label: '识别中', matchers: ['recogniz', 'ocr', 'formula', 'text', 'generate'] },
	{ id: 'finalize', label: '整理结果', matchers: ['merge', 'render', 'finaliz', 'serializ', 'export'] }
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

const isValidFileSize = (file: File): boolean => file.size <= MAX_FILE_SIZE

const formatFileSize = (bytes: number): string => {
	if (bytes < 1024) return `${bytes} B`
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
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

export function FileUpload({
	onFileUploaded,
	onTaskStatusChange
}: FileUploadProps) {
	const [selectedFile, setSelectedFile] = useState<UploadedFile | null>(null)
	const [isDragging, setIsDragging] = useState(false)
	const [processingMode, setProcessingMode] = useState<ProcessingMode>('pipeline')
	const [isLoading, setIsLoading] = useState(false)
	const [latestStatus, setLatestStatus] = useState<TaskStatusData | null>(null)
	const [currentTaskId, setCurrentTaskId] = useState<string | null>(null)
	const [taskIdCopied, setTaskIdCopied] = useState(false)

	const fileInputRef = useRef<HTMLInputElement>(null)
	const pollingIntervalsRef = useRef<Map<string, NodeJS.Timeout>>(new Map())

	const handleDragOver = (e: React.DragEvent) => {
		if (isLoading) return
		e.preventDefault()
		setIsDragging(true)
	}

	const handleDragLeave = (e: React.DragEvent) => {
		if (isLoading) return
		e.preventDefault()
		setIsDragging(false)
	}

	const handleDrop = (e: React.DragEvent) => {
		if (isLoading) return
		e.preventDefault()
		setIsDragging(false)
		const droppedFiles = Array.from(e.dataTransfer.files)
		if (droppedFiles.length > 0) handleFile(droppedFiles[0])
	}

	const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
		if (isLoading) return
		const selectedFiles = e.target.files
		if (selectedFiles && selectedFiles.length > 0) {
			handleFile(selectedFiles[0])
			if (fileInputRef.current) fileInputRef.current.value = ''
		}
	}

	const handleFile = async (file: File) => {
		if (!isValidFileType(file)) {
			toast.error(
				`不支持的文件格式。支持：${ALLOWED_EXTENSIONS.join(', ').toUpperCase()}`
			)
			if (fileInputRef.current) fileInputRef.current.value = ''
			return
		}
		if (!isValidFileSize(file)) {
			toast.error(
				`文件过大。${formatFileSize(file.size)} / ${formatFileSize(MAX_FILE_SIZE)}`
			)
			if (fileInputRef.current) fileInputRef.current.value = ''
			return
		}

		setIsLoading(true)
		setLatestStatus(null)
		setCurrentTaskId(null)
		const uploadedFile: UploadedFile = {
			id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
			name: file.name,
			size: file.size,
			type: normalizeFileType(file),
			file: file,
			uploadTime: new Date(),
			error: null,
			processingMode
		}
		setSelectedFile(uploadedFile)

		try {
			const uploadParams: Parameters<typeof uploadTask>[0] = {
				file,
				custom_url: undefined,
				processing_mode: processingMode
			}
			const response = await uploadTask(uploadParams)
			const taskId = String(response.task_id)
			setCurrentTaskId(taskId)
			onFileUploaded(uploadedFile)
			if (taskId) startPolling(uploadedFile.id, taskId)
		} catch (error: any) {
			const errorMessage =
				error.response?.data?.message || error.message || '文件上传失败'
			toast.error(errorMessage)
			setSelectedFile(null)
			setIsLoading(false)
		}
	}

	const handlePaste = (e: ClipboardEvent) => {
		if (isLoading || e.defaultPrevented || isEditablePasteTarget(e.target)) return
		const clipboardItems = Array.from(e.clipboardData?.items ?? [])
		const imageItem = clipboardItems.find(
			item => item.kind === 'file' && item.type.startsWith('image/')
		)
		if (!imageItem) return
		const pastedFile = imageItem.getAsFile()
		if (!pastedFile) return
		e.preventDefault()
		void handleFile(createClipboardImageFile(pastedFile))
	}

	const startPolling = (fileId: string, taskId: string | number) => {
		stopPolling(fileId)
		pollTaskStatus(fileId, taskId)
		const interval = setInterval(
			() => pollTaskStatus(fileId, taskId),
			2000
		)
		pollingIntervalsRef.current.set(fileId, interval)
	}

	const stopPolling = (fileId: string) => {
		const interval = pollingIntervalsRef.current.get(fileId)
		if (interval) {
			clearInterval(interval)
			pollingIntervalsRef.current.delete(fileId)
		}
	}

	const pollTaskStatus = async (fileId: string, taskId: string | number) => {
		try {
			const response = await getTaskStatus(taskId)
			const { status, error_message } = response
			setLatestStatus(response)
			onTaskStatusChange?.({ fileId, status, response, error_message })
			if (status === 'completed' || status === 'failed') {
				stopPolling(fileId)
				setIsLoading(false)
			}
		} catch (error: any) {
			console.error('查询任务状态失败:', error)
			stopPolling(fileId)
			setIsLoading(false)
		}
	}

	useEffect(() => {
		return () => {
			pollingIntervalsRef.current.forEach(interval => clearInterval(interval))
			pollingIntervalsRef.current.clear()
		}
	}, [])

	useEffect(() => {
		window.addEventListener('paste', handlePaste)
		return () => window.removeEventListener('paste', handlePaste)
	}, [isLoading, processingMode])

	const copyTaskId = async () => {
		if (!currentTaskId) return
		try {
			await navigator.clipboard.writeText(currentTaskId)
			setTaskIdCopied(true)
			toast.success('已复制 task ID')
			window.setTimeout(() => setTaskIdCopied(false), 1200)
		} catch {
			toast.error('复制失败')
		}
	}

	const stageIndex = resolveStageIndex(latestStatus?.current_stage)
	const showTimeline = isLoading || latestStatus?.status === 'processing'

	return (
		<div className='flex h-full flex-col bg-white'>
			<div className='flex flex-col gap-4 p-4'>
				<div>
					<h2 className='text-[15px] font-semibold tracking-tight text-foreground'>
						文件上传
					</h2>
					<p className='mt-0.5 text-[11px] text-muted-foreground'>
						拖拽、点击选择或粘贴图片
					</p>
				</div>

				<div className='rounded-lg bg-zinc-100 p-1'>
					<div className='grid grid-cols-2 gap-1 text-sm'>
						{MODE_OPTIONS.map(option => {
							const active = processingMode === option.id
							const Icon = option.icon
							return (
								<button
									key={option.id}
									type='button'
									disabled={isLoading}
									aria-pressed={active}
									onClick={() => setProcessingMode(option.id)}
									className={cn(
										'flex flex-col items-center gap-0.5 rounded-md px-2 py-1.5 transition-[background-color,color,box-shadow] duration-200',
										active
											? 'bg-white text-foreground shadow-sm ring-1 ring-border'
											: 'text-muted-foreground hover:text-foreground',
										isLoading && 'cursor-not-allowed opacity-60'
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
						'relative rounded-xl border-2 border-dashed px-4 py-8 text-center transition-[background-color,border-color,transform] duration-200',
						isLoading && 'cursor-wait opacity-80',
						!isLoading && 'cursor-pointer',
						isDragging
							? 'scale-[1.01] border-primary bg-primary/5'
							: 'border-zinc-300 hover:border-primary/50 hover:bg-zinc-50'
					)}
					onDragOver={handleDragOver}
					onDragLeave={handleDragLeave}
					onDrop={handleDrop}
					onClick={() => {
						if (!isLoading) fileInputRef.current?.click()
					}}>
					{selectedFile?.file && isLoading ? (
						<div className='flex flex-col items-center gap-2'>
							<Loader2 className='size-7 animate-spin text-primary' />
							<p className='line-clamp-2 break-all text-sm font-medium leading-5'>
								{selectedFile.name}
							</p>
							<p className='text-[11px] text-muted-foreground'>
								{formatFileSize(selectedFile.size)}
							</p>
						</div>
					) : (
						<div className='flex flex-col items-center gap-2'>
							<span
								className={cn(
									'flex size-12 items-center justify-center rounded-full transition-colors duration-200',
									isDragging
										? 'bg-primary/10 text-primary'
										: 'bg-zinc-100 text-zinc-500'
								)}>
								<UploadCloud
									className={cn(
										'size-6',
										isDragging && 'motion-safe:animate-bounce'
									)}
								/>
							</span>
							<p className='text-sm font-medium text-foreground'>
								{isDragging ? '松手上传文件' : '点击或拖拽到此处'}
							</p>
							<p className='flex items-center justify-center gap-1 text-[11px] text-muted-foreground'>
								或按 <kbd>⌘</kbd>
								<span className='text-muted-foreground/70'>/</span>
								<kbd>Ctrl</kbd>
								<kbd>V</kbd> 粘贴图片
							</p>
							<p className='text-[11px] text-muted-foreground/80'>
								PNG · JPG · JPEG · PDF · 最大 20 MB
							</p>
						</div>
					)}
				</div>

				<input
					ref={fileInputRef}
					type='file'
					className='hidden'
					accept='image/*,.pdf'
					disabled={isLoading}
					onChange={handleFileInput}
				/>
			</div>

			{showTimeline && (
				<div className='mx-4 mb-4 rounded-lg border border-border bg-zinc-50/80 p-3'>
					<div className='mb-3 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground'>
						<Clock className='size-3.5' />
						{latestStatus?.current_stage || '排队中'}
					</div>
					<ol className='space-y-2'>
						{STAGE_STEPS.map((step, index) => {
							const state =
								index < stageIndex
									? 'done'
									: index === stageIndex
										? 'active'
										: 'idle'
							return (
								<li key={step.id} className='flex items-center gap-2'>
									<span
										className={cn(
											'flex size-4 items-center justify-center rounded-full transition-colors duration-200',
											state === 'done' && 'bg-primary text-primary-foreground',
											state === 'active' && 'bg-primary text-primary-foreground motion-safe:animate-pulse',
											state === 'idle' && 'bg-zinc-200 text-muted-foreground'
										)}>
										{state === 'done' ? (
											<Check className='size-2.5' />
										) : (
											<span className='size-1.5 rounded-full bg-current' />
										)}
									</span>
									<span
										className={cn(
											'text-[12px]',
											state === 'idle'
												? 'text-muted-foreground'
												: 'text-foreground'
										)}>
										{step.label}
									</span>
								</li>
							)
						})}
					</ol>
				</div>
			)}

			{selectedFile && !isLoading && (
				<div className='mx-4 mb-4 space-y-2 rounded-lg border border-border bg-white p-3 text-[12px]'>
					<div className='flex items-start gap-2'>
						<FileText className='mt-0.5 size-3.5 shrink-0 text-muted-foreground' />
						<p className='line-clamp-2 break-all font-medium text-foreground'>
							{selectedFile.name}
						</p>
					</div>
					<div className='flex flex-wrap items-center gap-1.5 text-muted-foreground'>
						<Badge
							variant='outline'
							className='h-5 rounded-full px-2 text-[10px] font-normal'>
							{formatFileSize(selectedFile.size)}
						</Badge>
						<Badge
							variant='outline'
							className='h-5 rounded-full px-2 text-[10px] font-normal'>
							{selectedFile.processingMode === 'formula' ? '公式' : '文档'}
						</Badge>
						{currentTaskId && (
							<button
								type='button'
								onClick={copyTaskId}
								aria-label='复制任务 ID'
								className={cn(
									'ml-auto inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground hover:bg-zinc-100 hover:text-foreground'
								)}>
								{taskIdCopied ? (
									<Check className='size-3' />
								) : (
									<ClipboardCopy className='size-3' />
								)}
								<span className='max-w-[5.5rem] truncate'>{currentTaskId}</span>
							</button>
						)}
					</div>
				</div>
			)}
		</div>
	)
}
