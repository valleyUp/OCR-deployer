/**
 * iOS-design-language motion tokens.
 * Spring-physics curves, not generic easings.
 */

/* spring — quick, responsive. Use for button taps, toggles, checkmarks. */
export const SPRING_QUICK = 'cubic-bezier(0.22, 0.95, 0.34, 1.02)'

/* spring — smooth, with gentle overshoot. Use for panel entrances, card reveals. */
export const SPRING_SMOOTH = 'cubic-bezier(0.34, 1.56, 0.64, 1)'

/* decelerate — iOS scroll-like. Use for things coming to rest. */
export const DECELERATE = 'cubic-bezier(0.05, 0.7, 0.1, 1)'

export const DURATION = {
	instant: 80,
	fast: 180,
	normal: 280,
	slow: 420,
	entrance: 520
} as const

export const TRANSITION_BASE =
	'transition-[background-color,color,border-color,box-shadow,transform,opacity] duration-180 ease-out'

export const TRANSITION_SLOW =
	'transition-[background-color,color,border-color,box-shadow,transform,opacity] duration-300 ease-out'

export const CARD_ENTER =
	'motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 motion-safe:duration-300'

export const MENU_ENTER =
	'motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-95 motion-safe:duration-200 origin-top-right'
