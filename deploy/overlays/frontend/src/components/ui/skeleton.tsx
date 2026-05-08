import { cn } from '@/libs/utils'

interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {}

export function Skeleton({ className, ...props }: SkeletonProps) {
	return (
		<div
			className={cn(
				'animate-pulse rounded-md bg-zinc-200/70',
				className
			)}
			{...props}
		/>
	)
}
