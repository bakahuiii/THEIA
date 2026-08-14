export const MODEL_PROVIDER_IDS = Object.freeze([
  'openai-compatible',
  'anthropic-messages',
  'gemini-generate-content',
  'ollama-chat',
])

export function normalizeModelProvider(value) {
  return MODEL_PROVIDER_IDS.includes(value) ? value : 'openai-compatible'
}
