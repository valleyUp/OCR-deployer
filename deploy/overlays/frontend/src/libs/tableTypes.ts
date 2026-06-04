export type TableCell = {
	text: string
	tag: 'th' | 'td'
	align?: 'left' | 'center' | 'right'
	colspan?: number
	rowspan?: number
}

export type TableRow = TableCell[]

export type CopyableTable = {
	html: string
	plainText: string
	source: 'markdown' | 'html'
}
