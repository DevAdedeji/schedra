import { describe, expect, it } from 'vitest'
import { isAmbiguousRefundFailure, refundProviderState } from './paid-booking'

describe('paid booking refund state', () => {
  it('normalizes terminal provider states without guessing about in-progress states', () => {
    expect(refundProviderState('COMPLETED')).toBe('paid')
    expect(refundProviderState('refunded')).toBe('paid')
    expect(refundProviderState('rejected')).toBe('failed')
    expect(refundProviderState('processing')).toBe('pending')
    expect(refundProviderState('unknown-new-state')).toBe('pending')
  })

  it('keeps timeouts and transient provider errors pending for reconciliation', () => {
    expect(isAmbiguousRefundFailure(new Error('socket closed'))).toBe(true)
    expect(isAmbiguousRefundFailure({ statusCode: 408 })).toBe(true)
    expect(isAmbiguousRefundFailure({ statusCode: 409 })).toBe(true)
    expect(isAmbiguousRefundFailure({ statusCode: 429 })).toBe(true)
    expect(isAmbiguousRefundFailure({ statusCode: 503 })).toBe(true)
  })

  it('recognizes provider rejections that are safe to show as failed', () => {
    expect(isAmbiguousRefundFailure({ statusCode: 400 })).toBe(false)
    expect(isAmbiguousRefundFailure({ statusCode: 403 })).toBe(false)
    expect(isAmbiguousRefundFailure({ statusCode: 404 })).toBe(false)
  })
})
