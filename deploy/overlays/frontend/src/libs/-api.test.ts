import { describe, expect, it } from 'vitest'
import { taskFileUrl } from './api'

describe('taskFileUrl', () => {
	it('builds an encoded source file URL for persisted task previews', () => {
		const url = taskFileUrl('/app/data/task 1/source file.pdf')

		expect(url).toBe('/api/v1/tasks/file?path=%2Fapp%2Fdata%2Ftask%201%2Fsource%20file.pdf')
	})
})
