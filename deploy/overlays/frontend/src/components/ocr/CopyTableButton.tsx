import { FileSpreadsheet } from 'lucide-react'
import { toast } from 'sonner'
import { isMarkdownTable, markdownTableToHtml, copyHtmlToClipboard } from '@/libs/tableUtils'

interface CopyTableButtonProps {
	content: string
	className?: string
}

export function CopyTableButton({ content, className = '' }: CopyTableButtonProps) {
	const handleCopy = async () => {
		if (!content) return

		// Check if content is a markdown table
		if (!isMarkdownTable(content)) {
			toast.error('Not a valid table')
			return
		}

		// Convert markdown table to HTML
		const html = markdownTableToHtml(content)
		if (!html) {
			toast.error('Failed to convert table')
			return
		}

		// Copy HTML to clipboard
		const success = await copyHtmlToClipboard(html)
		if (success) {
			toast.success('Word table copied')
		} else {
			toast.error('Copy failed')
		}
	}

	return (
		<button
			data-ocr-copy-table-button
			onClick={handleCopy}
			className={`absolute py-1 px-3 -top-6 right-0 h-6 flex items-center justify-center gap-1 z-10 backdrop-blur-sm pointer-events-auto bg-black/65 text-white rounded-md cursor-pointer text-nowrap ${className}`}
		>
			<FileSpreadsheet size={14} strokeWidth={1.5} />
			<span>Word</span>
		</button>
	)
}
