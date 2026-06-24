import { describe, expect, it } from 'vitest'
import { resolvePageDimensions } from './pageDimensions'

describe('resolvePageDimensions', () => {
	it('prefers block page dimensions', () => {
		const dimensions = resolvePageDimensions(
			2,
			{
				width: 100,
				height: 200,
				page_sizes: [{ page_index: 2, width: 300, height: 400 }],
			},
			{ pageWidth: 500, pageHeight: 600 },
		)

		expect(dimensions).toEqual({ width: 500, height: 600 })
	})

	it('uses page_sizes for mixed-page PDF results', () => {
		const dimensions = resolvePageDimensions(2, {
			width: 100,
			height: 200,
			page_sizes: [
				{ page_index: 1, width: 100, height: 200 },
				{ page_index: 2, width: 320, height: 180 },
			],
		})

		expect(dimensions).toEqual({ width: 320, height: 180 })
	})

	it('falls back to legacy first-page metadata', () => {
		const dimensions = resolvePageDimensions(3, { width: 100, height: 200 })

		expect(dimensions).toEqual({ width: 100, height: 200 })
	})
})
