/**
 * Scheme A — Minimal Neutral: motion tokens.
 * Duration scale: 80 / 150 / 260 / 440 / 620ms
 */

export const DURATION = {
	instant: 80,
	fast: 150,
	normal: 260,
	slow: 440,
	elaborate: 620
} as const

export const EASE_OUT = 'cubic-bezier(.16,1,.3,1)'
export const EASE_SPRING = 'cubic-bezier(.34,1.56,.64,1)'
export const EASE_SMOOTH = 'cubic-bezier(.85,0,.15,1)'

export const TRANSITION_BASE =
	'transition-[background-color,color,border-color,box-shadow,transform,opacity] duration-150 ease-out'

export const TRANSITION_SLOW =
	'transition-[background-color,color,border-color,box-shadow,transform,opacity] duration-300 ease-out'

export const CARD_ENTER =
	'motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-1 motion-safe:duration-200'

export const MENU_ENTER =
	'motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-95 motion-safe:duration-150 origin-top-right'
