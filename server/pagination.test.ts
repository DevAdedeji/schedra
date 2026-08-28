import { describe, expect, it } from 'vitest'
import { paginationMeta, paginationQuerySchema } from '../shared/pagination'

describe('pagination contract', () => {
  it('defaults every list endpoint to ten items per page', () => {
    expect(paginationQuerySchema.parse({})).toMatchObject({ page: 1, pageSize: 10 })
  })

  it('rejects requests that exceed the public page-size contract', () => {
    expect(paginationQuerySchema.safeParse({ pageSize: 11 }).success).toBe(false)
  })

  it('always reports at least one page for an empty list', () => {
    expect(paginationMeta(0, 1, 10)).toEqual({
      page: 1,
      pageSize: 10,
      total: 0,
      totalPages: 1
    })
  })
})
