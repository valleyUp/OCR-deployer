import { useState, useRef, useEffect } from 'react'
import { FileText, Loader2, Sigma, Upload } from 'lucide-react'
import { cn } from '@/libs/utils'
import { uploadTask, getTaskStatus, type TaskStatus, type TaskStatusData } from '@/libs/api'
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

// 允许的文件格式
const ALLOWED_FILE_TYPES = [
	'image/png',
	'image/jpeg',
	'image/jpg',
	'application/pdf'
]

// 允许的文件扩展名（用于备用验证）
const ALLOWED_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.pdf']
// const ALLOWED_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.pdf', '.doc', '.docx']

// 文件大小限制：20MB
const MAX_FILE_SIZE = 20 * 1024 * 1024 // 20MB in bytes
type ProcessingMode = 'pipeline' | 'formula'
const CLIPBOARD_IMAGE_PREFIX = 'clipboard-image'

const inferMimeTypeByName = (name: string): string => {
	const lowerName = name.toLowerCase()
	if (lowerName.endsWith('.pdf')) return 'application/pdf'
	if (lowerName.endsWith('.png')) return 'image/png'
	if (lowerName.endsWith('.jpg') || lowerName.endsWith('.jpeg')) return 'image/jpeg'
	return ''
}

const normalizeFileType = (file: File): string => {
	return file.type || inferMimeTypeByName(file.name)
}

const getFileExtensionByMimeType = (mimeType: string): string => {
	switch (mimeType) {
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

	return new File([file], `${CLIPBOARD_IMAGE_PREFIX}-${timestamp}.${extension}`, {
		type: normalizedType,
		lastModified: Date.now()
	})
}

const isEditablePasteTarget = (target: EventTarget | null): boolean => {
	if (!(target instanceof HTMLElement)) return false
	if (target.isContentEditable) return true
	return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}


// 验证文件类型
const isValidFileType = (file: File): boolean => {
	const normalizedType = normalizeFileType(file)
	// 检查 MIME 类型
	if (ALLOWED_FILE_TYPES.includes(normalizedType)) {
		return true
	}

	// 备用检查：通过文件扩展名
	const fileName = file.name.toLowerCase()
	return ALLOWED_EXTENSIONS.some(ext => fileName.endsWith(ext))
}

// 验证文件大小
const isValidFileSize = (file: File): boolean => {
	return file.size <= MAX_FILE_SIZE
}

// 格式化文件大小
const formatFileSize = (bytes: number): string => {
	if (bytes < 1024) return bytes + ' B'
	if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB'
	return (bytes / (1024 * 1024)).toFixed(2) + ' MB'
}

export function FileUpload({ onFileUploaded, onTaskStatusChange }: FileUploadProps) {
	const [selectedFile, setSelectedFile] = useState<UploadedFile | null>(null)
	const [isDragging, setIsDragging] = useState(false)
	const [processingMode, setProcessingMode] = useState<ProcessingMode>('pipeline')
	const fileInputRef = useRef<HTMLInputElement>(null)
	const pollingIntervalsRef = useRef<Map<string, NodeJS.Timeout>>(new Map())
	const [isLoading, setIsLoading] = useState(false)


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
		if (droppedFiles.length > 0) {
			handleFile(droppedFiles[0])
		}
	}

	const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
		if (isLoading) return
		const selectedFiles = e.target.files
		if (selectedFiles && selectedFiles.length > 0) {
			handleFile(selectedFiles[0])
			// 重置 input 的值，这样下次选择相同文件时也能触发 onChange
			if (fileInputRef.current) {
				fileInputRef.current.value = ''
			}
		}
	}

	const handleFile = async (file: File) => {
		// 验证文件类型
		if (!isValidFileType(file)) {
			toast.error(
				`不支持的文件格式。支持的格式：${ALLOWED_EXTENSIONS.join(', ').toUpperCase()}`
			)
			// 重置 input 的值
			if (fileInputRef.current) {
				fileInputRef.current.value = ''
			}
			return
		}

		// 验证文件大小
		if (!isValidFileSize(file)) {
			toast.error(
				`文件大小超过限制。当前文件：${formatFileSize(file.size)}，最大允许：${formatFileSize(MAX_FILE_SIZE)}`
			)
			// 重置 input 的值
			if (fileInputRef.current) {
				fileInputRef.current.value = ''
			}
			return
		}

		setIsLoading(true)
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
				file: file,
				custom_url: undefined,
				processing_mode: processingMode
			}

			const response = await uploadTask(uploadParams)

			// 上传成功，更新文件状态并开始轮询
			const taskId = String(response.task_id)

			onFileUploaded(uploadedFile)

			// 开始轮询任务状态
			if (taskId) {
				startPolling(uploadedFile.id, taskId)
			}
		} catch (error: any) {
			// 上传失败
			const errorMessage = error.response?.data?.message || error.message || '文件上传失败'
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

	// 开始轮询任务状态
	const startPolling = (fileId: string, taskId: string | number) => {
		// 如果已经有轮询在进行，先清除
		stopPolling(fileId)

		// 立即查询一次
		pollTaskStatus(fileId, taskId)

		// 设置定时轮询，每 2 秒查询一次
		const interval = setInterval(() => {
			pollTaskStatus(fileId, taskId)
		}, 2000)

		pollingIntervalsRef.current.set(fileId, interval)
	}

	// 停止轮询
	const stopPolling = (fileId: string) => {
		const interval = pollingIntervalsRef.current.get(fileId)
		if (interval) {
			clearInterval(interval)
			pollingIntervalsRef.current.delete(fileId)
		}
	}

	// 查询任务状态
	const pollTaskStatus = async (fileId: string, taskId: string | number) => {
		try {
			const response = await getTaskStatus(taskId)
			const { status, error_message } = response

			// 更新任务状态（error_message 对应 error），并保存完整的响应
			onTaskStatusChange?.({
				fileId,
				status,
				response,
				error_message
			})

			// 如果任务完成或失败，停止轮询
			if (status === 'completed' || status === 'failed') {
				stopPolling(fileId)
				setIsLoading(false)
			}
		} catch (error: any) {
			console.error('查询任务状态失败:', error)
			// 查询失败时也停止轮询，避免无限重试
			stopPolling(fileId)
			setIsLoading(false)
		}
	}

	// 组件卸载时清理所有轮询
	useEffect(() => {
		return () => {
			pollingIntervalsRef.current.forEach(interval => clearInterval(interval))
			pollingIntervalsRef.current.clear()
		}
	}, [])

	useEffect(() => {
		window.addEventListener('paste', handlePaste)
		return () => {
			window.removeEventListener('paste', handlePaste)
		}
	}, [isLoading, processingMode])

	return (
		<div className='h-full flex flex-col bg-white dark:bg-gray-900 border-r border-border'>
			{/* 文件上传区域 */}
			<div className='p-4'>
				<h2 className='text-lg font-semibold mb-4'>文件上传</h2>
				<div className='mb-4 grid grid-cols-2 rounded-md border bg-gray-50 p-1 text-sm'>
					<button
						type='button'
						disabled={isLoading}
						onClick={() => setProcessingMode('pipeline')}
						className={cn(
							'h-8 rounded-sm flex items-center justify-center gap-1.5 transition-colors',
							processingMode === 'pipeline'
								? 'bg-white text-gray-950 shadow-sm'
								: 'text-gray-600 hover:text-gray-950'
						)}>
						<FileText className='size-4' />
						文档 OCR
					</button>
					<button
						type='button'
						disabled={isLoading}
						onClick={() => setProcessingMode('formula')}
						className={cn(
							'h-8 rounded-sm flex items-center justify-center gap-1.5 transition-colors',
							processingMode === 'formula'
								? 'bg-white text-gray-950 shadow-sm'
								: 'text-gray-600 hover:text-gray-950'
						)}>
						<Sigma className='size-4' />
						公式识别
					</button>
				</div>
				<div
					className={cn(
						'border-2 border-dashed rounded-lg py-8 px-4 text-center cursor-pointer transition-colors',
						isDragging
							? 'border-primary bg-primary/5'
							: 'border-gray-300 dark:border-gray-700 hover:border-primary/50'
					)}
					onDragOver={handleDragOver}
					onDragLeave={handleDragLeave}
					onDrop={handleDrop}
					onClick={() => fileInputRef.current?.click()}>
					{selectedFile?.file && isLoading ? (
						<>
							<div className='flex items-start justify-center gap-2'>
								<Loader2 className='animate-spin' />
								<p className='text-sm font-medium line-clamp-2 break-all leading-6'>
									{selectedFile.name}
								</p>
							</div>
						</>
					) : (
						<>
							<Upload className='size-12 mx-auto mb-4 text-gray-400' />
							<p className='text-sm font-medium mb-1'>点击或拖拽文件到此处</p>
							<p className='text-xs text-gray-500'>或按 Ctrl+V / Cmd+V 直接粘贴图片</p>
							<p className='text-xs text-gray-500'>
								格式：png/jpg/jpeg, pdf
								{/* 格式：png/jpg/jpeg, pdf, doc, docx */}
							</p>
							<p className='text-xs text-gray-400 mt-1'>最大 20MB</p>
						</>
					)}
				</div>

				<input
					ref={fileInputRef}
					type='file'
					className='hidden'
					accept='image/*,.pdf,.doc,.docx'
					disabled={isLoading}
					onChange={handleFileInput}
				/>
			</div>
		</div>
	)
}
