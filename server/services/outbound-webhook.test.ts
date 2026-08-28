import { describe, expect, it, vi } from 'vitest'
import { isPublicWebhookAddress, validateWebhookDestination } from './outbound-webhook'

describe('outbound webhook destination security', () => {
  it.each([
    '127.0.0.1',
    '10.0.0.1',
    '169.254.169.254',
    '172.16.0.1',
    '192.168.1.2',
    '192.0.2.1',
    '198.51.100.2',
    '203.0.113.2',
    '::1',
    'fc00::1',
    'fe80::1',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '2001:db8::1'
  ])('rejects non-public address %s', (address) => {
    expect(isPublicWebhookAddress(address)).toBe(false)
  })

  it.each(['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111'])('accepts public address %s', (address) => {
    expect(isPublicWebhookAddress(address)).toBe(true)
  })

  it('requires HTTPS and rejects credentials', async () => {
    const resolvePublic = vi.fn().mockResolvedValue([{ address: '1.1.1.1', family: 4 }])
    await expect(validateWebhookDestination('http://hooks.example.com', resolvePublic)).rejects.toThrow('HTTPS')
    await expect(validateWebhookDestination('https://user:secret@hooks.example.com', resolvePublic)).rejects.toThrow('credentials')
  })

  it('rejects a hostname when any DNS answer is private', async () => {
    const resolver = vi.fn().mockResolvedValue([
      { address: '1.1.1.1', family: 4 },
      { address: '10.0.0.8', family: 4 }
    ])
    await expect(validateWebhookDestination('https://hooks.example.com/delivery', resolver))
      .rejects.toThrow('public internet')
  })

  it('normalizes a valid public destination', async () => {
    const resolver = vi.fn().mockResolvedValue([{ address: '1.1.1.1', family: 4 }])
    await expect(validateWebhookDestination('https://hooks.example.com/delivery', resolver))
      .resolves.toBe('https://hooks.example.com/delivery')
  })

  it('returns a safe message when DNS resolution fails', async () => {
    const resolver = vi.fn().mockRejectedValue(new Error('getaddrinfo ENOTFOUND secret.internal'))
    await expect(validateWebhookDestination('https://missing.example.com/hook', resolver))
      .rejects.toThrow('Webhook hostname could not be resolved.')
  })
})
