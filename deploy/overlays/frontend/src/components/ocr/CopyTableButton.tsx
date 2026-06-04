import { useMemo, useState, type MouseEvent } from 'react'
import { FileSpreadsheet } from 'lucide-react'
import { toast } from 'sonner'
import { copyTableToClipboard, extractCopyableTable } from '@/libs/tableUtils'

interface CopyTableButtonProps {
	content: string
	layoutType?: string
	className?: string
}

export function CopyTableButton({ content, layoutType, className = '' }: CopyTableButtonProps) {
	const [busy, setBusy] = useState(false)
	const table = useMemo(() => extractCopyableTable(content, layoutType), [content, layoutType])

	const handleCopy = async (event: MouseEvent<HTMLButtonElement>) => {
		event.stopPropagation()
		if (!table || busy) {
			if (!table) toast.error('未检测到可复制表格')
			return
		}

		setBusy(true)
		try {
			const success = await copyTableToClipboard(table)
			if (success) {
				toast.success('表格已复制，可粘贴到 Word')
			} else {
				toast.error('复制失败')
			}
		} finally {
			setBusy(false)
		}
	}

	return (
		<button
			data-ocr-copy-button
			data-ocr-copy-table-button
			onClick={handleCopy}
			disabled={!table || busy}
			title='复制为 Word 表格'
			className={`absolute py-1 px-3 -top-6 right-0 h-6 flex items-center justify-center gap-1 z-10 backdrop-blur-sm pointer-events-auto bg-black/65 text-white rounded-md cursor-pointer text-nowrap disabled:cursor-not-allowed disabled:opacity-55 ${className}`}
		>
			<FileSpreadsheet size={14} strokeWidth={1.5} />
			<span>{busy ? '复制中' : '复制表格'}</span>
		</button>
	)
}
