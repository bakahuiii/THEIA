import { normalizeModelProvider } from '../../core/model-provider-policy.mjs'
import { OpenAICompatibleProvider } from './openai-compatible.mjs'
import { ProtocolProvider } from './protocol-provider.mjs'

export function createAdvisorProvider({ modelService, settings }) {
  const protocol = normalizeModelProvider(settings?.modelProvider)
  if (protocol === 'openai-compatible') return new OpenAICompatibleProvider({ modelService, settings })
  return new ProtocolProvider({ modelService, settings, protocol })
}
