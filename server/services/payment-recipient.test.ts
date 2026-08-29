import { describe, expect, it } from 'vitest'
import { recipientNextAction, recipientStatus } from './payment-recipient'

describe('payment recipient status', () => {
  it('only marks an account ready when transfers and payouts are active', () => {
    expect(recipientStatus({
      id: 'acct_ready',
      capabilities: {
        payouts: { requested: true, status: 'active' },
        transfers: { requested: true, status: 'active' }
      }
    })).toBe('active')
  })

  it('does not mark an account ready when transfers are still under review', () => {
    expect(recipientStatus({
      id: 'acct_transfer_review',
      details_submitted: true,
      capabilities: {
        payouts: { requested: true, status: 'active' },
        transfers: { requested: true, status: 'pending' }
      }
    })).toBe('pending_review')
  })

  it('keeps accounts with outstanding fields in onboarding', () => {
    expect(recipientStatus({
      id: 'acct_onboarding',
      capabilities: { payouts: { requested: true, status: 'pending' } },
      requirements: { currently_due: ['individual.id_document'] }
    })).toBe('onboarding')
  })

  it('does not trust an active payout flag while onboarding requirements remain', () => {
    expect(recipientStatus({
      id: 'acct_inconsistent',
      is_active: true,
      capabilities: {
        payouts: { requested: true, status: 'active' },
        transfers: { requested: true, status: 'active' }
      },
      requirements: {
        currently_due: ['persons.name', 'payout_destination']
      }
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

  it('keeps payout destination requirements inside hosted onboarding', () => {
    expect(recipientNextAction({
      bachsAccountId: 'acct_destination',
      status: 'onboarding',
      requirements: { currently_due: ['payout_destination'] }
    } as never)).toBe('provider_onboarding')
  })

  it('keeps identity requirements in the hosted provider flow', () => {
    expect(recipientNextAction({
      bachsAccountId: 'acct_identity',
      status: 'onboarding',
      requirements: { currently_due: ['individual.id_document'] }
    } as never)).toBe('provider_onboarding')
  })

  it('does not enable payments while the account-wide setup is incomplete', () => {
    expect(recipientStatus({
      id: 'acct_incomplete',
      status: 'incomplete',
      setup_status: 'incomplete',
      capabilities: {
        payouts: { requested: true, status: 'active' },
        transfers: { requested: true, status: 'active' }
      },
      requirements: { setup_status: 'incomplete', currently_due: [] }
    })).toBe('onboarding')
  })

  it('honours the account-level incomplete state shown in Bachs', () => {
    expect(recipientStatus({
      id: 'acct_dashboard_incomplete',
      status: 'INCOMPLETE',
      capabilities: {
        payouts: { requested: true, status: 'active' },
        transfers: { requested: true, status: 'active' }
      }
    })).toBe('onboarding')
  })

  it('requires Bachs to explicitly activate both money movement capabilities', () => {
    expect(recipientStatus({
      id: 'acct_payout_only',
      capabilities: { payouts: { requested: true, status: 'active' } }
    })).not.toBe('active')
  })

  it('maps an account-level review state even when capabilities look active', () => {
    expect(recipientStatus({
      id: 'acct_account_review',
      status: 'under-review',
      capabilities: {
        payouts: { requested: true, status: 'active' },
        transfers: { requested: true, status: 'active' }
      }
    })).toBe('pending_review')
  })
})
