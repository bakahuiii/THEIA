import { lookup as dnsLookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { Agent } from 'undici'

const EXPLICIT_LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1'])
const MAX_RESOLVED_ADDRESSES = 32

const IPV4_DENY_CIDRS = Object.freeze([
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['168.63.129.16', 32],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.31.196.0', 24],
  ['192.52.193.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['192.175.48.0', 24],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
])

const IPV6_PUBLIC_CIDR = ['2000::', 3]
const IPV6_DENY_CIDRS = Object.freeze([
  ['2001::', 23],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['2620:4f:8000::', 48],
  ['3ffe::', 16],
  ['3fff::', 20],
])

function withoutBrackets(value) {
  const text = String(value || '').trim().toLowerCase()
  return text.startsWith('[') && text.endsWith(']') ? text.slice(1, -1) : text
}

function literalHostname(raw) {
  const match = raw.match(/^[a-z][a-z0-9+.-]*:\/\/([^/?#]*)/i)
  if (!match || match[1].includes('@')) return null
  const authority = match[1]
  if (authority.startsWith('[')) {
    const end = authority.indexOf(']')
    if (end < 0 || !/^:\d*$/.test(authority.slice(end + 1)) && authority.slice(end + 1) !== '') return null
    return authority.slice(1, end).toLowerCase()
  }
  return authority.replace(/:\d*$/, '').toLowerCase()
}

function ipv4Value(address) {
  return address.split('.').reduce((value, part) => (value << 8n) | BigInt(part), 0n)
}

function ipv6Value(address) {
  let text = address.toLowerCase()
  if (text.includes('.')) {
    const separator = text.lastIndexOf(':')
    const embedded = text.slice(separator + 1)
    if (isIP(embedded) !== 4) throw new Error('Invalid IPv4-embedded IPv6 address')
    const bytes = embedded.split('.').map(Number)
    text = `${text.slice(0, separator)}:${((bytes[0] << 8) | bytes[1]).toString(16)}:${((bytes[2] << 8) | bytes[3]).toString(16)}`
  }
  const halves = text.split('::')
  if (halves.length > 2) throw new Error('Invalid IPv6 address')
  const left = halves[0] ? halves[0].split(':') : []
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : []
  const missing = 8 - left.length - right.length
  if ((halves.length === 1 && missing !== 0) || missing < 0) throw new Error('Invalid IPv6 address')
  const parts = halves.length === 2 ? [...left, ...Array(missing).fill('0'), ...right] : left
  return parts.reduce((value, part) => (value << 16n) | BigInt(`0x${part || '0'}`), 0n)
}

function inCidr(value, base, prefix, bits) {
  const shift = BigInt(bits - prefix)
  return (value >> shift) === (base >> shift)
}

const IPV4_DENY_RANGES = IPV4_DENY_CIDRS.map(([address, prefix]) => [ipv4Value(address), prefix])
const IPV6_PUBLIC_RANGE = [ipv6Value(IPV6_PUBLIC_CIDR[0]), IPV6_PUBLIC_CIDR[1]]
const IPV6_DENY_RANGES = IPV6_DENY_CIDRS.map(([address, prefix]) => [ipv6Value(address), prefix])

export function isPublicModelAddress(value) {
  const address = withoutBrackets(value)
  const family = isIP(address)
  if (family === 4) {
    const parsed = ipv4Value(address)
    return !IPV4_DENY_RANGES.some(([base, prefix]) => inCidr(parsed, base, prefix, 32))
  }
  if (family === 6) {
    const parsed = ipv6Value(address)
    return inCidr(parsed, IPV6_PUBLIC_RANGE[0], IPV6_PUBLIC_RANGE[1], 128)
      && !IPV6_DENY_RANGES.some(([base, prefix]) => inCidr(parsed, base, prefix, 128))
  }
  return false
}

function isExactLocalAddress(address) {
  return address === '127.0.0.1' || address === '::1'
}

function normalizeResolvedAddresses(value) {
  if (!Array.isArray(value) || !value.length || value.length > MAX_RESOLVED_ADDRESSES) {
    throw new Error('Model service host did not resolve to a safe address set')
  }
  const result = new Map()
  for (const record of value) {
    const address = withoutBrackets(record?.address)
    const family = isIP(address)
    if (!family || Number(record?.family) !== family) {
      throw new Error('Model service host returned an invalid address')
    }
    result.set(`${family}:${address}`, Object.freeze({ address, family }))
  }
  return Object.freeze([...result.values()])
}

function pinnedLookup(expectedHostname, addresses) {
  return (hostname, options, callback) => {
    if (withoutBrackets(hostname) !== expectedHostname) {
      const error = new Error('Pinned model dispatcher refused an unexpected host')
      error.code = 'ENOTFOUND'
      callback(error)
      return
    }
    const requestedFamily = Number(options?.family) || 0
    const candidates = requestedFamily ? addresses.filter((record) => record.family === requestedFamily) : addresses
    if (!candidates.length) {
      const error = new Error('Pinned model dispatcher has no approved address for the requested family')
      error.code = 'ENOTFOUND'
      callback(error)
      return
    }
    if (options?.all === true) callback(null, candidates.map((record) => ({ ...record })))
    else callback(null, candidates[0].address, candidates[0].family)
  }
}

export function createPinnedModelDispatcher({ lookup }) {
  return new Agent({ connect: { lookup }, autoSelectFamily: true })
}

function abortError(signal) {
  const error = new Error('Model endpoint resolution was cancelled')
  error.name = 'AbortError'
  error.cause = signal?.reason
  return error
}

async function resolveWithAbort(resolver, hostname, signal) {
  if (signal?.aborted) throw abortError(signal)
  let removeAbortListener = () => {}
  const aborted = new Promise((resolve, reject) => {
    const onAbort = () => reject(abortError(signal))
    signal?.addEventListener?.('abort', onAbort, { once: true })
    removeAbortListener = () => signal?.removeEventListener?.('abort', onAbort)
  })
  try {
    return await Promise.race([
      Promise.resolve().then(() => resolver(hostname, { all: true, verbatim: true })),
      aborted,
    ])
  } finally {
    removeAbortListener()
  }
}

export async function prepareModelEndpoint(value, {
  resolver = dnsLookup,
  dispatcherFactory = createPinnedModelDispatcher,
  signal,
} = {}) {
  const raw = String(value || '').trim()
  const url = new URL(raw)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Model request target is invalid')
  }
  const hostname = withoutBrackets(url.hostname)
  const explicitLocal = EXPLICIT_LOCAL_HOSTS.has(hostname)
  if (explicitLocal && literalHostname(raw) !== hostname) {
    throw new Error('Loopback model service URLs must use an explicit literal address')
  }
  if (url.protocol === 'http:' && !explicitLocal) {
    throw new Error('Model service URL must use HTTPS unless it is an explicit loopback address')
  }

  const literalFamily = isIP(hostname)
  const addresses = literalFamily
    ? Object.freeze([Object.freeze({ address: hostname, family: literalFamily })])
    : normalizeResolvedAddresses(await resolveWithAbort(resolver, hostname, signal))

  const safe = explicitLocal
    ? addresses.every((record) => isExactLocalAddress(record.address))
    : addresses.every((record) => isPublicModelAddress(record.address))
  if (!safe) throw new Error('Model service host resolves to a blocked local or special-use address')

  const lookup = pinnedLookup(hostname, addresses)
  const dispatcher = dispatcherFactory({ hostname, addresses, lookup })
  if (!dispatcher || typeof dispatcher !== 'object') throw new Error('Model dispatcher could not be created')
  return {
    addresses,
    dispatcher,
    lookup,
    async close({ force = false } = {}) {
      if (force && typeof dispatcher.destroy === 'function') {
        await dispatcher.destroy()
        return
      }
      await dispatcher.close?.()
    },
  }
}
