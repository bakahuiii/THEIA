import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { defaultDataRoot } from '../core/runtime-paths.mjs'

export async function discoverTheiaRuntime({ dataRoot = defaultDataRoot() } = {}) {
  const runtime = JSON.parse(await readFile(resolve(dataRoot, 'api-runtime.json'), 'utf8'))
  if (runtime?.host !== '127.0.0.1' || !Number.isInteger(runtime?.port)
    || runtime.port < 1 || runtime.port > 65_535
    || !Number.isInteger(runtime?.pid) || runtime.pid < 1
    || !Number.isFinite(Date.parse(String(runtime?.startedAt || '')))) {
    throw new Error('THEIA runtime metadata is invalid')
  }
  if (typeof runtime.token !== 'string' || runtime.token.length < 16) {
    throw new Error('THEIA runtime token is missing; restart the desktop app (0.6.0+ regenerates it)')
  }
  try {
    process.kill(runtime.pid, 0)
  } catch {
    throw new Error('THEIA desktop runtime is not running')
  }
  return { baseUrl: `http://127.0.0.1:${runtime.port}`, token: runtime.token }
}

export async function discoverTheiaApi({ dataRoot = defaultDataRoot() } = {}) {
  return (await discoverTheiaRuntime({ dataRoot })).baseUrl
}

export async function fetchTheiaFeed({ baseUrl, dataRoot, token, timeoutMs = 5_000 } = {}) {
  let endpoint = baseUrl || null
  let apiToken = token || null
  if (!endpoint || !apiToken) {
    const runtime = await discoverTheiaRuntime({ dataRoot })
    endpoint = endpoint || runtime.baseUrl
    apiToken = apiToken || runtime.token
  }
  const url = new URL('/v1/feed', endpoint)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${apiToken}` },
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(`THEIA API returned ${response.status}`)
    const feed = await response.json()
    if (feed?.schema !== 'theia-campus-feed/v1' || !Array.isArray(feed.events) || !Array.isArray(feed.tasks)) throw new Error('THEIA feed schema mismatch')
    return feed
  } finally {
    clearTimeout(timer)
  }
}
