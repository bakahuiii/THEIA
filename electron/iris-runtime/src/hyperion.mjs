/** Narrow loopback-only client for HYPERION's Bot API. */

function normalizedBaseUrl(value) {
  const fallback = 'http://127.0.0.1:8787'
  try {
    const url = new URL(value || fallback)
    if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') throw new Error('HYPERION_API must be a loopback address')
    return url.toString().replace(/\/$/, '')
  } catch {
    return fallback
  }
}

function requestError(path, response, payload) {
  const detail = typeof payload?.error === 'string' ? payload.error.slice(0, 300) : ''
  return new Error(`HYPERION ${path} -> ${response.status}${detail ? `: ${detail}` : ''}`)
}

export function createHyperionClient({ baseUrl = process.env.HYPERION_API } = {}) {
  const base = normalizedBaseUrl(baseUrl)

  async function request(path, options = {}) {
    const response = await fetch(`${base}${path}`, {
      cache: 'no-store',
      headers: { 'content-type': 'application/json', ...(options.headers ?? {}) },
      ...options,
    })
    let payload = null
    try { payload = await response.json() } catch { /* The local proxy should always return JSON. */ }
    if (!response.ok) throw requestError(path, response, payload)
    return payload
  }

  return {
    summary: () => request('/api/bot/summary'),
    ai: () => request('/api/bot/ai'),
    selene: () => request('/api/bot/selene'),
    quests: () => request('/api/bot/quests'),
    people: (query = '') => request(`/api/bot/people?q=${encodeURIComponent(query)}`),
    journal: async (content) => {
      const receipt = await request('/api/bot/journal', { method: 'POST', body: JSON.stringify({ content }) })
      const record = receipt?.record
      if (!record || record.conversationId !== 'self-journal' || record.speakerRole !== 'self' || typeof record.id !== 'string') {
        throw new Error('HYPERION journal write was not durably acknowledged')
      }
      return receipt
    },
    checkIn: (fields) => request('/api/bot/check-in', { method: 'POST', body: JSON.stringify(fields) }),
    completeQuest: (id) => request(`/api/bot/quests/${encodeURIComponent(id)}/complete`, { method: 'POST', body: '{}' }),
  }
}
