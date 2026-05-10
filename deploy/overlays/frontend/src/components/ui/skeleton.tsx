import { cn } from '@/libs/utils'

interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {}

export function Skeleton({ className, ...props }: SkeletonProps) {
	return (
		<div
			className={cn(
				'ios-skeleton rounded-full',
				className
			)}
			{...props}
		/>
	)
}
