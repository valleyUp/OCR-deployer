/**
 * Motion tokens — spring-physics curves & timing system.
 * Aligned with the Scheme B Structured design spec.
 */

/* Spring — responsive with overshoot. Use for buttons, toggles, card reveals. */
export const EASE_SPRING = 'cubic-bezier(0.34, 1.56, 0.64, 1)'

/* Out-expo — fast in, slow out. Most common transition curve. */
export const EASE_OUT_EXPO = 'cubic-bezier(0.16, 1, 0.3, 1)'

/* In-out-circ — smooth symmetric. Use for things settling into place. */
export const EASE_IN_OUT_CIRC = 'cubic-bezier(0.85, 0, 0.15, 1)'

/* Decelerate — scroll-like deceleration. */
export const DECELERATE = 'cubic-bezier(0.05, 0.7, 0.1, 1)'

export const DURATION = {
	instant: 80,
	fast: 150,
	normal: 250,
	slow: 400,
	elaborate: 600
} as const

export const TRANSITION_BASE =
	'transition-[background-color,color,border-color,box-shadow,transform,opacity] duration-150 ease-out'

export const TRANSITION_SLOW =
	'transition-[background-color,color,border-color,box-shadow,transform,opacity] duration-250 ease-out'

export const CARD_ENTER =
	'motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 motion-safe:duration-300'

export const MENU_ENTER =
	'motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-95 motion-safe:duration-200 origin-top-right'
