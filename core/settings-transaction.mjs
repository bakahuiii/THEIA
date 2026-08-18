function clampNumber(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, Math.trunc(Number(value))))
}

function mergeAdvisorConfig(current, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return current
  return {
    ...current,
    ...(typeof input.budgetLevel === 'string' && ['high', 'xhigh', 'max', 'ultra'].includes(input.budgetLevel)
      ? { budgetLevel: input.budgetLevel }
      : {}),
    ...(typeof input.permissionMode === 'string' && ['read-only', 'full-access'].includes(input.permissionMode)
      ? { permissionMode: input.permissionMode }
      : {}),
    ...(typeof input.reasoningEffort === 'string' && ['none', 'low', 'medium', 'high', 'xhigh', 'max'].includes(input.reasoningEffort)
      ? { reasoningEffort: input.reasoningEffort }
      : {}),
    ...(typeof input.responseStyle === 'string' && ['direct', 'balanced', 'detailed'].includes(input.responseStyle)
      ? { responseStyle: input.responseStyle }
      : {}),
    ...(typeof input.responseLength === 'string' && ['adaptive', 'short', 'standard', 'detailed'].includes(input.responseLength)
      ? { responseLength: input.responseLength }
      : {}),
    ...(typeof input.temperature === 'number' && Number.isFinite(input.temperature)
      ? { temperature: Math.max(0, Math.min(2, input.temperature)) }
      : {}),
  }
}

export function mergeAllowedSettings(current, input) {
  const allowed = input && typeof input === 'object' ? input : {}
  return {
    ...current,
    ...(Number.isFinite(Number(allowed.apiPort)) && Number(allowed.apiPort) !== 0
      ? { apiPort: clampNumber(allowed.apiPort, 1024, 65535) }
      : {}),
    ...(Number.isFinite(Number(allowed.syncIntervalMinutes)) && Number(allowed.syncIntervalMinutes) !== 0
      ? { syncIntervalMinutes: clampNumber(allowed.syncIntervalMinutes, 5, 1440) }
      : {}),
    ...(typeof allowed.autoSync === 'boolean' ? { autoSync: allowed.autoSync } : {}),
    ...(typeof allowed.openOriginalInApp === 'boolean' ? { openOriginalInApp: allowed.openOriginalInApp } : {}),
    ...(allowed.academicAuthMode === 'api' || allowed.academicAuthMode === 'unified'
      ? { academicAuthMode: allowed.academicAuthMode }
      : {}),
    ...(typeof allowed.academicApiEnabled === 'boolean' ? { academicApiEnabled: allowed.academicApiEnabled } : {}),
    ...(allowed.mail && typeof allowed.mail === 'object' ? {
      mail: {
        ...current.mail,
        ...(typeof allowed.mail.enabled === 'boolean' ? { enabled: allowed.mail.enabled } : {}),
        ...(Number.isFinite(Number(allowed.mail.pollIntervalMinutes))
          ? { pollIntervalMinutes: clampNumber(allowed.mail.pollIntervalMinutes, 1, 60) }
          : {}),
      },
    } : {}),
    ...(allowed.advisorConfig && typeof allowed.advisorConfig === 'object' && !Array.isArray(allowed.advisorConfig) ? {
      advisorConfig: mergeAdvisorConfig(current.advisorConfig, allowed.advisorConfig),
    } : {}),
  }
}

export async function updateSettingsTransaction({
  store,
  next,
  restartLocalApi,
  configureAutoSync = () => {},
  configureMail = () => {},
  publishSnapshot = () => {},
}) {
  const previousSettings = structuredClone(store.snapshot().settings)
  let snapshot
  let settingsWritten = false
  try {
    snapshot = await store.update((state) => ({
      ...state,
      settings: mergeAllowedSettings(state.settings, next),
    }))
    settingsWritten = true
    configureAutoSync(snapshot.settings.autoSync, snapshot.settings.syncIntervalMinutes)
    configureMail(snapshot.settings.mail)
    if (snapshot.settings.apiPort !== previousSettings.apiPort) {
      const api = await restartLocalApi(snapshot.settings.apiPort)
      if (api?.port !== snapshot.settings.apiPort) {
        snapshot = await store.update((state) => ({
          ...state,
          settings: { ...state.settings, apiPort: api.port },
        }))
      }
    }
    publishSnapshot(snapshot)
    return snapshot
  } catch (error) {
    if (!settingsWritten) throw error
    const rolledBack = await store.update((state) => ({
      ...state,
      settings: previousSettings,
    }))
    configureAutoSync(rolledBack.settings.autoSync, rolledBack.settings.syncIntervalMinutes)
    configureMail(rolledBack.settings.mail)
    publishSnapshot(rolledBack)
    throw error
  }
}
