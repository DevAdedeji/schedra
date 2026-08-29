import { describe, expect, it } from 'vitest'
import { EmailDeliveryError, isPermanentEmailDeliveryError } from '../integrations/email'
import { financialAlertCandidates, shouldNotifyOperationsAlert } from './operations-alerts'
import { isRetryableEmailJob } from './operations'

describe('operations email recovery', () => {
  const now = new Date('2026-08-28T12:00:00.000Z')

  it('allows terminal and genuinely delayed email deliveries to be retried', () => {
    expect(isRetryableEmailJob('failed', now, now)).toBe(true)
    expect(isRetryableEmailJob('pending', new Date('2026-08-28T11:44:59.000Z'), now)).toBe(true)
    expect(isRetryableEmailJob('sending', new Date('2026-08-28T11:40:00.000Z'), now)).toBe(true)
  })

  it('does not expose retry while normal backoff or delivery is in progress', () => {
    expect(isRetryableEmailJob('pending', new Date('2026-08-28T11:55:00.000Z'), now)).toBe(false)
    expect(isRetryableEmailJob('sending', new Date('2026-08-28T11:59:00.000Z'), now)).toBe(false)
    expect(isRetryableEmailJob('sent', new Date('2026-08-28T11:00:00.000Z'), now)).toBe(false)
  })
})

describe('operations alert notifications', () => {
  it('does not notify again after an operator acknowledges an incident', () => {
    expect(shouldNotifyOperationsAlert({ status: 'acknowledged', lastNotifiedAt: null })).toBe(false)
  })
  it('notifies once while an incident remains active', () => {
    expect(shouldNotifyOperationsAlert(null)).toBe(true)
    expect(shouldNotifyOperationsAlert({ status: 'active', lastNotifiedAt: new Date() })).toBe(false)
  })

  it('notifies once again when a resolved condition becomes a new incident', () => {
    expect(shouldNotifyOperationsAlert({ status: 'resolved', lastNotifiedAt: new Date() })).toBe(true)
  })

  it('turns abnormal money states into grouped operational alerts', () => {
    const candidates = financialAlertCandidates({
      expiredPendingPayments: 2,
      staleRefunds: 1,
      failedRefunds: 1,
      failedWithdrawals: 1,
      unresolvedWithdrawals: 1,
      restrictedRecipients: 3,
      ignoredFinancialWebhooks: 1
    })
    expect(candidates).toHaveLength(7)
    expect(candidates.map(item => item.key)).toContain('payments-refund-failed')
    expect(candidates.map(item => item.key)).toContain('payments-withdrawal-unresolved')
    expect(candidates.every(item => ['warning', 'critical'].includes(item.severity))).toBe(true)
  })
})

describe('permanent email delivery failures', () => {
  it('recognises provider validation and SMTP recipient rejections', () => {
    expect(isPermanentEmailDeliveryError(new EmailDeliveryError('Invalid recipient', { permanent: true, statusCode: 422 }))).toBe(true)
    expect(isPermanentEmailDeliveryError({ code: 'EENVELOPE' })).toBe(true)
    expect(isPermanentEmailDeliveryError({ responseCode: 550 })).toBe(true)
  })

  it('keeps authentication, rate-limit and temporary SMTP failures retryable', () => {
    expect(isPermanentEmailDeliveryError(new EmailDeliveryError('Unauthorized', { permanent: false, statusCode: 401 }))).toBe(false)
    expect(isPermanentEmailDeliveryError({ responseCode: 450 })).toBe(false)
  })
})
