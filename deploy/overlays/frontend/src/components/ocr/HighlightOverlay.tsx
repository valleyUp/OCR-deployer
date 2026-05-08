import type { Block } from '@/store/useOcrStore'
import { cn } from '@/libs/utils'
import { CopyButton } from './CopyButton'

type HighlightState = 'hover' | 'click'

interface HighlightOverlayProps {
	block: Block
	showCopyButton: boolean
	state?: HighlightState
	style: {
		left: number
		top: number
		width: number
		height: number
	}
	copyButtonClassName?: string
}

export function HighlightOverlay({
	block,
	showCopyButton,
	state = 'hover',
	style,
	copyButtonClassName
}: HighlightOverlayProps) {
	return (
		<div
			data-state={state}
			className={cn(
				'pointer-events-none absolute z-10 rounded-sm border transition-[background-color,border-color,box-shadow,transform] duration-150 ease-out',
				state === 'click'
					? 'border-amber-500/90 bg-amber-300/35 shadow-[0_0_0_2px_rgba(245,158,11,0.18)]'
					: 'border-amber-400/70 bg-amber-300/20'
			)}
			style={{
				left: `${style.left}px`,
				top: `${style.top}px`,
				width: `${style.width}px`,
				height: `${style.height}px`
			}}>
			{state === 'click' && (
				<span
					aria-hidden='true'
					className='pointer-events-none absolute inset-0 rounded-sm ring-2 ring-amber-400/40 motion-safe:animate-ping motion-safe:[animation-iteration-count:1] motion-safe:[animation-duration:800ms]'
				/>
			)}
			{showCopyButton && (
				<CopyButton
					content={block.content}
					className={cn(
						'motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-top-1 motion-safe:duration-150',
						copyButtonClassName
					)}
				/>
			)}
		</div>
	)
}
