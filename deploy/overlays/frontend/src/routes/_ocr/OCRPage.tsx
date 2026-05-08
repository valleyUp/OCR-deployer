import { useEffect, useState } from 'react'
import { FileUpload, type TaskResponse, type UploadedFile } from './FileUpload'
import { FilePreview } from './FilePreview'
import { OCRResults } from './OCRResults'
import { AppHeader } from '@/components/app/AppHeader'
import { ResizableDivider } from '@/components/app/ResizableDivider'
import '@/styles-overlay.css'

const RESULTS_WIDTH_KEY = 'ocr-deployer:resultsWidth'
const RESULTS_WIDTH_DEFAULT = 560
const RESULTS_WIDTH_MIN = 360
const RESULTS_WIDTH_MAX = 1100

function readStoredWidth(): number {
	if (typeof window === 'undefined') return RESULTS_WIDTH_DEFAULT
	try {
		const raw = window.localStorage.getItem(RESULTS_WIDTH_KEY)
		if (!raw) return RESULTS_WIDTH_DEFAULT
		const parsed = Number.parseInt(raw, 10)
		if (Number.isNaN(parsed)) return RESULTS_WIDTH_DEFAULT
		return Math.min(RESULTS_WIDTH_MAX, Math.max(RESULTS_WIDTH_MIN, parsed))
	} catch {
		return RESULTS_WIDTH_DEFAULT
	}
}

export function OCRPage() {
	const [uploadFile, setUploadFile] = useState<UploadedFile | null>(null)
	const [parsedResult, setParsedResult] = useState<TaskResponse | null>(null)
	const [resultsWidth, setResultsWidth] = useState<number>(RESULTS_WIDTH_DEFAULT)

	useEffect(() => {
		setResultsWidth(readStoredWidth())
	}, [])

	const persistResultsWidth = (next: number) => {
		try {
			window.localStorage.setItem(RESULTS_WIDTH_KEY, String(next))
		} catch {
			/* ignore quota / privacy-mode errors */
		}
	}

	const resetResultsWidth = () => {
		setResultsWidth(RESULTS_WIDTH_DEFAULT)
		persistResultsWidth(RESULTS_WIDTH_DEFAULT)
	}

	return (
		<div className='flex h-screen flex-col overflow-hidden bg-zinc-50'>
			<AppHeader uploadFile={uploadFile} result={parsedResult} />

			<div className='flex min-h-0 flex-1 overflow-hidden'>
				<aside className='w-60 shrink-0 border-r border-border bg-white'>
					<FileUpload
						onFileUploaded={file => setUploadFile(file)}
						onTaskStatusChange={data => setParsedResult(data)}
					/>
				</aside>

				<main className='flex min-w-0 flex-1 overflow-hidden'>
					<section className='flex min-w-0 flex-1 flex-col overflow-hidden bg-white'>
						<FilePreview file={uploadFile} result={parsedResult} />
					</section>

					<ResizableDivider
						value={resultsWidth}
						onChange={setResultsWidth}
						onCommit={persistResultsWidth}
						onReset={resetResultsWidth}
						min={RESULTS_WIDTH_MIN}
						max={RESULTS_WIDTH_MAX}
						direction='right'
						ariaLabel='调整结果区宽度'
					/>

					<section
						className='flex shrink-0 flex-col overflow-hidden border-l border-border bg-white'
						style={{ width: `${resultsWidth}px` }}>
						<OCRResults result={parsedResult} fileName={uploadFile?.name} />
					</section>
				</main>
			</div>
		</div>
	)
}
