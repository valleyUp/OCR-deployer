/**
 * Shared motion tokens. Kept as string constants so they are inlined by
 * Tailwind's content scanner and resolved at build time.
 */

export const TRANSITION_BASE =
	'transition-[background-color,color,border-color,box-shadow,transform,opacity] duration-150 ease-out'

export const TRANSITION_SLOW =
	'transition-[background-color,color,border-color,box-shadow,transform,opacity] duration-300 ease-out'

export const CARD_ENTER =
	'motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-1 motion-safe:duration-200'

export const MENU_ENTER =
	'motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-95 motion-safe:duration-150 origin-top-right'
