import { isIP } from 'node:net'
import { lookup } from 'node:dns/promises'

type Address = { address: string, family: number }
type Resolver = (hostname: string) => Promise<Address[]>

function privateIpv4(address: string) {
  const octets = address.split('.').map(Number)
  if (octets.length !== 4 || octets.some(value => !Number.isInteger(value) || value < 0 || value > 255)) return true
  const [a, b] = octets as [number, number, number, number]
  return a === 0
    || a === 10
    || a === 127
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 192 && b === 0 && octets[2] === 0)
    || (a === 192 && b === 0 && octets[2] === 2)
    || (a === 198 && (b === 18 || b === 19))
    || (a === 198 && b === 51 && octets[2] === 100)
    || (a === 203 && b === 0 && octets[2] === 113)
    || (a === 100 && b >= 64 && b <= 127)
    || a >= 224
}

function privateIpv6(address: string) {
  const normalized = address.toLowerCase().split('%')[0] ?? ''
  const dottedMapped = normalized.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1]
  if (dottedMapped) return privateIpv4(dottedMapped)
  const hexMapped = normalized.match(/::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/)
  if (hexMapped) {
    const high = Number.parseInt(hexMapped[1]!, 16)
    const low = Number.parseInt(hexMapped[2]!, 16)
    return privateIpv4(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`)
  }
  return normalized === '::'
    || normalized === '::1'
    || normalized.startsWith('fc')
    || normalized.startsWith('fd')
    || /^fe[89ab]/.test(normalized)
    || normalized.startsWith('ff')
    || normalized.startsWith('2001:db8')
}

export function isPublicWebhookAddress(address: string) {
  const family = isIP(address)
  if (family === 4) return !privateIpv4(address)
  if (family === 6) return !privateIpv6(address)
  return false
}

async function defaultResolver(hostname: string) {
  return lookup(hostname, { all: true, verbatim: true })
}

export async function validateWebhookDestination(value: string, resolver: Resolver = defaultResolver) {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('Enter a complete HTTPS webhook URL.')
  }

  if (url.protocol !== 'https:') throw new Error('Webhook URLs must use HTTPS.')
  if (url.username || url.password) throw new Error('Webhook URLs cannot contain credentials.')
  if (url.hostname === 'localhost' || url.hostname.endsWith('.local')) {
    throw new Error('Webhook URLs must use a public hostname.')
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, '')
  const literalFamily = isIP(hostname)
  let addresses: Address[]
  try {
    addresses = literalFamily
      ? [{ address: hostname, family: literalFamily }]
      : await resolver(hostname)
  } catch {
    throw new Error('Webhook hostname could not be resolved.')
  }

  if (!addresses.length || addresses.some(result => !isPublicWebhookAddress(result.address))) {
    throw new Error('Webhook URLs must resolve only to public internet addresses.')
  }

  return url.toString()
}
