import { describe, expect, it } from 'vitest'
import { getApiErrorMessage, taskFileUrl } from './api'

describe('taskFileUrl', () => {
	it('builds an encoded source file URL for persisted task previews', () => {
		const url = taskFileUrl('/app/data/task 1/source file.pdf')

		expect(url).toBe('/api/v1/tasks/file?path=%2Fapp%2Fdata%2Ftask%201%2Fsource%20file.pdf')
	})
})

describe('getApiErrorMessage', () => {
	it('prefers API detail and message fields before generic errors', () => {
		expect(getApiErrorMessage({ response: { data: { detail: 'bad mode' } } }, 'fallback')).toBe('bad mode')
		expect(getApiErrorMessage({ response: { data: { message: 'upload failed' } } }, 'fallback')).toBe('upload failed')
		expect(getApiErrorMessage(new Error('network down'), 'fallback')).toBe('network down')
		expect(getApiErrorMessage('not an error', 'fallback')).toBe('fallback')
	})
})
