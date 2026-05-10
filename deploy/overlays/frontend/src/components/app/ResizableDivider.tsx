import { useCallback, useEffect, useRef } from 'react'
import { cn } from '@/libs/utils'

interface ResizableDividerProps {
	value: number
	onChange: (next: number) => void
	onCommit?: (next: number) => void
	onReset?: () => void
	min: number
	max: number
	step?: number
	direction?: 'left' | 'right'
	ariaLabel?: string
	className?: string
}

/**
 * Thin vertical resize handle. The line is always visible (same weight as
 * sidebar border). A subtle drag handle appears on hover / keyboard focus.
 * Double-click resets to default width.
 */
export function ResizableDivider({
	value,
	onChange,
	onCommit,
	onReset,
	min,
	max,
	step = 16,
	direction = 'right',
	ariaLabel = '调整宽度',
	className
}: ResizableDividerProps) {
	const dragStateRef = useRef<{ startX: number; startValue: number } | null>(null)

	const clamp = useCallback(
		(next: number) => Math.min(max, Math.max(min, Math.round(next))),
		[min, max]
	)

	useEffect(() => {
		const handleMove = (event: MouseEvent) => {
			const state = dragStateRef.current
			if (!state) return
			const deltaX = event.clientX - state.startX
			const sign = direction === 'right' ? -1 : 1
			const next = clamp(state.startValue + sign * deltaX)
			onChange(next)
		}
		const handleUp = () => {
			const state = dragStateRef.current
			if (!state) return
			dragStateRef.current = null
			document.body.style.userSelect = ''
			document.body.style.cursor = ''
			onCommit?.(value)
		}
		window.addEventListener('mousemove', handleMove)
		window.addEventListener('mouseup', handleUp)
		return () => {
			window.removeEventListener('mousemove', handleMove)
			window.removeEventListener('mouseup', handleUp)
		}
	}, [onChange, onCommit, clamp, direction, value])

	const beginDrag = (event: React.MouseEvent<HTMLDivElement>) => {
		event.preventDefault()
		dragStateRef.current = { startX: event.clientX, startValue: value }
		document.body.style.userSelect = 'none'
		document.body.style.cursor = 'col-resize'
	}

	const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
		if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
			event.preventDefault()
			const sign = direction === 'right' ? -1 : 1
			const delta = event.key === 'ArrowLeft' ? -step : step
			const next = clamp(value + sign * delta)
			onChange(next)
			onCommit?.(next)
		} else if (event.key === 'Home') {
			event.preventDefault()
			onChange(min)
			onCommit?.(min)
		} else if (event.key === 'End') {
			event.preventDefault()
			onChange(max)
			onCommit?.(max)
		}
	}

	const handleDoubleClick = () => {
		if (onReset) onReset()
	}

	return (
		<div
			role='separator'
			aria-orientation='vertical'
			aria-label={ariaLabel}
			aria-valuenow={value}
			aria-valuemin={min}
			aria-valuemax={max}
			tabIndex={0}
			onMouseDown={beginDrag}
			onKeyDown={handleKeyDown}
			onDoubleClick={handleDoubleClick}
			className={cn(
				'group relative flex w-1 shrink-0 cursor-col-resize items-center justify-center outline-none',
				className
			)}>
			{/* Thin line — always visible, matching sidebar border weight */}
			<span
				aria-hidden='true'
				className='absolute inset-y-4 left-1/2 w-px -translate-x-1/2 rounded-full bg-[rgba(0,0,0,0.06)] transition-colors duration-200 group-hover:bg-[rgba(0,0,0,0.14)] group-active:bg-blue-400/50'
			/>
			{/* Drag handle pip — appears on hover, grows on active */}
			<span
				aria-hidden='true'
				className='absolute top-1/2 left-1/2 h-8 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-transparent transition-all duration-200 group-hover:bg-[rgba(0,0,0,0.16)] group-active:h-12 group-active:w-1.5 group-active:bg-blue-400/60 group-focus-visible:bg-[rgba(0,0,0,0.16)]'
			/>
		</div>
	)
}
