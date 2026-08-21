import { app, safeStorage } from 'electron'
import { writeFile } from 'node:fs/promises'
import { CampusStore } from '../core/store.mjs'
import { defaultDataRoot } from '../core/runtime-paths.mjs'
import {
  createAdvisorFullAccessTools,
  createAdvisorReadOnlyTools,
  runReadOnlyAdvisorAgent,
} from '../core/advisor/index.mjs'
import { ModelVault } from '../electron/model-vault.mjs'
import { ModelService } from '../electron/model-service.mjs'
import { createAdvisorProvider } from '../electron/ai/provider-factory.mjs'

const root = defaultDataRoot()
const reportPath = process.argv.find((value) => value.startsWith('--report='))?.slice('--report='.length)
  || process.argv.find((value) => /theia-live-agent-report\.json$/iu.test(value))
  || null
app.setName('THEIA')
app.setPath('userData', root)

async function report(value) {
  const line = JSON.stringify(value)
  if (reportPath) await writeFile(reportPath, `${line}\n`, 'utf8')
  console.log(line)
}

function safeError(error) {
  const message = error instanceof Error ? error.message : String(error || 'Unknown error')
  return message.replace(/Bearer\s+[^\s]+/giu, 'Bearer [redacted]').slice(0, 500)
}

async function runLiveCheck() {
  try {
  const store = new CampusStore(root)
  await store.load()
  const settings = store.snapshot().settings || {}
  const vault = new ModelVault(root, safeStorage)
  const modelService = new ModelService({ vault })
  const status = await modelService.status(settings)
  if (!status.configured) {
    await report({
      ok: false,
      stage: 'saved-model-status',
      provider: status.provider,
      model: status.model,
      apiKeySaved: status.apiKeySaved,
      encryptionAvailable: status.encryptionAvailable,
      requiresApiKeyReentry: status.requiresApiKeyReentry,
      error: status.error || null,
    })
    process.exitCode = 1
    return
  }

  const baseTools = createAdvisorReadOnlyTools({
    snapshotRevision: 'live-agent-check',
    dataQuality: { schema: 'theia-live-check/v1', domains: {} },
    claims: [],
    urgentItems: [],
    risks: [],
  })
  const tools = createAdvisorFullAccessTools({
    tools: baseTools,
    snapshotRevision: 'live-agent-check',
    operations: {},
  })
  const provider = createAdvisorProvider({ modelService, settings })
  const result = await runReadOnlyAdvisorAgent({
    provider,
    model: status.model,
    tools,
    permissionMode: 'full-access',
    messages: [{ role: 'user', content: '请只用一句中文确认你已收到完全访问会话的实时连通性检查。不要调用工具，不要包含任何密钥或内部协议。' }],
    temperature: 0,
    reasoningEffort: settings.advisorConfig?.reasoningEffort || 'medium',
    responseStyle: 'direct',
    responseLength: 'short',
  })
  await report({
    ok: true,
    provider: status.provider,
    model: status.model,
    textCharacters: result.text.length,
    modelCalls: result.modelCalls,
    toolCalls: result.calls.length,
    cacheStatus: result.cacheStatus,
    cachedInputTokens: result.cachedInputTokens,
  })
  process.exitCode = 0
  } catch (error) {
    await report({ ok: false, error: safeError(error) })
    process.exitCode = 1
  } finally {
    await app.quit()
  }
}

void app.whenReady().then(runLiveCheck)
