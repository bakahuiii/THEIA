import { createHash, randomUUID } from 'node:crypto'

function keyFingerprint(apiKey) {
  return createHash('sha256').update(String(apiKey || ''), 'utf8').digest('hex')
}

export class ModelProbeTickets {
  constructor({ now = () => Date.now(), createId = () => randomUUID(), lifetimeMs = 5 * 60_000, maximum = 50 } = {}) {
    this.now = now
    this.createId = createId
    this.lifetimeMs = lifetimeMs
    this.maximum = maximum
    this.tickets = new Map()
  }

  prune() {
    const current = this.now()
    for (const [id, ticket] of this.tickets) {
      if (ticket.expiresAt <= current) this.tickets.delete(id)
    }
    while (this.tickets.size >= this.maximum) this.tickets.delete(this.tickets.keys().next().value)
  }

  issue({ baseUrl, apiKey, models, succeeded, provider = 'openai-compatible' }) {
    this.prune()
    const probeId = this.createId()
    this.tickets.set(probeId, {
      baseUrl,
      provider,
      keyFingerprint: keyFingerprint(apiKey),
      models: [...models],
      succeeded: Boolean(succeeded),
      expiresAt: this.now() + this.lifetimeMs,
    })
    return probeId
  }

  consume({ probeId, baseUrl, apiKey, modelName, allowManualModel, provider = 'openai-compatible' }) {
    const ticket = this.tickets.get(probeId)
    this.tickets.delete(probeId)
    if (!ticket || ticket.expiresAt <= this.now()) throw new Error('Detect the model connection again before saving')
    if (ticket.baseUrl !== baseUrl || ticket.keyFingerprint !== keyFingerprint(apiKey) || ticket.provider !== provider) {
      throw new Error('The model address or API key changed after detection, or the protocol changed; detect again before saving')
    }
    if ((!ticket.succeeded || !ticket.models.includes(modelName)) && allowManualModel !== true) {
      throw new Error('Select a detected model or explicitly choose a manual model ID')
    }
    return [...ticket.models]
  }
}
