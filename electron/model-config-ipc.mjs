import { normalizeModelProvider } from '../core/model-provider-policy.mjs'
import { normalizeModelServiceBaseUrl } from '../core/model-url-policy.mjs'
import { saveModelConfigTransaction } from './model-config-transaction.mjs'
import { preferredModel } from './model-service.mjs'

export function registerModelConfigIpc({
  ipcMain,
  modelService,
  modelVault,
  modelProbeTickets,
  store,
  sendSnapshot,
  rebuildAdvisorRuntime = async () => {},
} = {}) {
  ipcMain.handle('theia:discover-models', async (_event, config) => {
    const next = config && typeof config === 'object' ? config : {}
    const baseUrl = normalizeModelServiceBaseUrl(next.baseUrl)
    const apiKey = typeof next.apiKey === 'string' ? next.apiKey.trim() : ''
    if (!baseUrl) throw new Error('Enter a model service URL before detecting models')
    const provider = normalizeModelProvider(next.provider)
    try {
      if (provider !== 'openai-compatible') {
        throw new Error('This provider does not expose a portable model-list contract. Enter the exact model ID manually after testing the connection.')
      }
      const result = await modelService.discover({ baseUrl, apiKey })
      return { ...result, probeId: modelProbeTickets.issue({ baseUrl, apiKey, provider, models: result.models, succeeded: true }) }
    } catch (error) {
      const warning = error instanceof Error ? error.message : String(error)
      return {
        models: [],
        selectedModel: null,
        probeId: modelProbeTickets.issue({ baseUrl, apiKey, provider, models: [], succeeded: false }),
        warning: warning.slice(0, 1_000),
      }
    }
  })

  ipcMain.handle('theia:save-model-config', async (_event, config) => {
    const next = config && typeof config === 'object' ? config : {}
    const previousAdvisorBudgetLevel = store.snapshot().settings.advisorConfig?.budgetLevel
    const baseUrl = normalizeModelServiceBaseUrl(next.baseUrl)
    const requestedModel = String(next.model || '').trim()
    const provider = normalizeModelProvider(next.provider)
    if (baseUrl.length > 1_000 || requestedModel.length > 300) throw new Error('Model service configuration is too long')
    const explicitApiKey = typeof next.apiKey === 'string' ? next.apiKey.trim() : ''
    const probeId = String(next.probeId || '').trim()
    let models
    if (probeId) {
      models = modelProbeTickets.consume({
        probeId,
        baseUrl,
        apiKey: explicitApiKey,
        modelName: requestedModel,
        allowManualModel: next.allowManualModel,
        provider,
      })
    } else {
      // A settings-only edit may reuse the current service binding, but any
      // service, model, or key change still requires a fresh probe ticket.
      const currentSettings = store.snapshot().settings || {}
      const currentBaseUrl = normalizeModelServiceBaseUrl(currentSettings.modelBaseUrl)
      const sameService = currentBaseUrl === baseUrl
        && normalizeModelProvider(currentSettings.modelProvider) === provider
        && String(currentSettings.modelName || '').trim() === requestedModel
      if (!sameService || explicitApiKey) {
        throw new Error('修改了模型地址、协议、模型或 API Key，请先检测连接再保存')
      }
      if (provider !== 'ollama-chat') await modelVault.readApiKey(baseUrl)
      models = Array.isArray(currentSettings.modelModels) ? [...currentSettings.modelModels] : []
      if (!models.includes(requestedModel)) models.push(requestedModel)
    }
    const modelName = preferredModel(models, requestedModel)
    if (!modelName) throw new Error('No selectable model was detected. Enter a model ID manually.')
    await saveModelConfigTransaction({
      store,
      vault: modelVault,
      baseUrl,
      modelName,
      models,
      modelRouting: next.modelRouting,
      advisorConfig: { ...(store.snapshot().settings.advisorConfig || {}), ...(next.advisorConfig || {}) },
      modelProvider: provider,
      allowKeyless: provider === 'ollama-chat' && !explicitApiKey,
      apiKey: explicitApiKey,
      publishSnapshot: sendSnapshot,
    })
    if (next.advisorConfig?.budgetLevel && next.advisorConfig.budgetLevel !== previousAdvisorBudgetLevel) {
      await rebuildAdvisorRuntime()
    }
    return modelService.status(store.snapshot().settings)
  })
}
