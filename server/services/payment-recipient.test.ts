import { describe, expect, it } from 'vitest'
import { recipientStatus } from './payment-recipient'

describe('payment recipient status', () => {
  it('only marks an account ready when payouts are active', () => {
    expect(recipientStatus({
      id: 'acct_ready',
      capabilities: { payouts: { requested: true, status: 'active' } }
    })).toBe('active')
  })

  it('keeps accounts with outstanding fields in onboarding', () => {
    expect(recipientStatus({
      id: 'acct_onboarding',
      capabilities: { payouts: { requested: true, status: 'pending' } },
      requirements: { currently_due: ['individual.id_document'] }
    })).toBe('onboarding')
  })

  it('shows review while submitted details are being verified', () => {
    expect(recipientStatus({
      id: 'acct_review',
      capabilities: { payouts: { requested: true, status: 'pending' } },
      requirements: { pending_verification: ['individual.id_document'] }
    })).toBe('pending_review')
  })

  it('surfaces rejected details as an action-required state', () => {
    expect(recipientStatus({
      id: 'acct_restricted',
      capabilities: { payouts: { requested: true, status: 'restricted' } },
      requirements: {
        errors: [{ field: 'individual.id_document', code: 'unreadable' }]
      }
    })).toBe('restricted')
  })

  it('preserves the provider disabled state', () => {
    expect(recipientStatus({ id: 'acct_disabled', is_active: false })).toBe('disabled')
  })
})
