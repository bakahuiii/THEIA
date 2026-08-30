import { randomUUID } from 'node:crypto'
import { AuthRequiredError, SessionClient } from '../core/source-client.mjs'
import { TyglAdapter } from '../core/adapters/tygl.mjs'
import { cachedFitnessResult } from '../core/data-catalog.mjs'
import { failFitnessCatalog, updateFitnessCatalog } from '../core/catalog-provenance.mjs'

const FITNESS_YEAR_KEY = /^20\d{2}-20\d{2}_\d+$/

export function requestedFitnessYear(value) {
  const year = String(value || '')
  return FITNESS_YEAR_KEY.test(year) ? year : null
}

export function isAuthenticationFailure(error) {
  return error instanceof AuthRequiredError
    || /auth|login|credential|认证|登录/i.test(`${error?.name || ''} ${error?.code || ''} ${error?.message || ''}`)
}

export function createFitnessRuntime({
  store,
  schoolSession,
  loadFitnessBrowserPage,
  loadFitnessPage,
  submitFitnessForm,
  openLoginWindow,
  assertAuthEpoch,
  getAuthEpoch = () => 0,
  sendSnapshot = () => {},
  writeDiagnostic = async () => {},
  diagnosticUrl = (url) => url,
  diagnosticError = (error) => String(error?.message || error),
} = {}) {
  async function fetchFitnessScoreFromSchool(year, expectedEpoch = getAuthEpoch()) {
    assertAuthEpoch(expectedEpoch)
    const selectedYear = requestedFitnessYear(year) || undefined
    const request = async () => {
      assertAuthEpoch(expectedEpoch)
      const priorityClient = new SessionClient(schoolSession, {
        pageLoader: (url, options = {}) => loadFitnessBrowserPage(url, { ...options, priority: 1 }),
        formLoader: (url, values, options) => submitFitnessForm(url, values, options),
        onDiagnostic: (event, fields) => writeDiagnostic(event, {
          ...fields,
          ...(fields.url ? { url: diagnosticUrl(fields.url) } : {}),
        }),
      })
      const result = await new TyglAdapter(priorityClient, { fitnessPageLoader: loadFitnessPage }).fetchScore({ year: selectedYear })
      assertAuthEpoch(expectedEpoch)
      return result
    }
    try {
      return await request()
    } catch (error) {
      if (error?.name !== 'AuthRequiredError') throw error
      assertAuthEpoch(expectedEpoch)
      const ready = await ensureFitnessSession({ expectedEpoch })
      assertAuthEpoch(expectedEpoch)
      if (!ready) throw new Error('健康云统一身份认证未完成，请确认已保存统一认证账号后重试')
      return request()
    }
  }

  async function importFitnessArchive(requestedYear, expectedEpoch = getAuthEpoch()) {
    assertAuthEpoch(expectedEpoch)
    const attemptedAt = new Date().toISOString()
    const runId = randomUUID()
    let first
    try {
      first = await fetchFitnessScoreFromSchool(requestedYear, expectedEpoch)
      assertAuthEpoch(expectedEpoch)
    } catch (error) {
      const completedAt = new Date().toISOString()
      await store.update((state) => failFitnessCatalog(state, {
        runId,
        attemptedAt,
        completedAt,
        status: isAuthenticationFailure(error) ? 'auth-required' : 'failed',
        errorCode: isAuthenticationFailure(error) ? 'fitness_auth_required' : 'fitness_read_failed',
      }))
      sendSnapshot()
      throw error
    }
    const results = [first]
    const failures = []
    const seen = new Set([first.yearKey].filter(Boolean))

    // One visit establishes the list. Hydrate each missing year so later
    // switching is local and does not reopen the health-cloud UI.
    for (const entry of first.availableYears || []) {
      if (!requestedFitnessYear(entry.yearKey) || seen.has(entry.yearKey)) continue
      try {
        const result = await fetchFitnessScoreFromSchool(entry.yearKey, expectedEpoch)
        assertAuthEpoch(expectedEpoch)
        results.push(result)
        if (result.yearKey) seen.add(result.yearKey)
      } catch (error) {
        failures.push({
          yearKey: entry.yearKey,
          status: isAuthenticationFailure(error) ? 'auth-required' : 'failed',
          errorCode: isAuthenticationFailure(error) ? 'fitness_auth_required' : 'fitness_year_read_failed',
        })
        void writeDiagnostic('fitness.year_cache_failed', {
          yearKey: entry.yearKey,
          error: diagnosticError(error),
        })
      }
    }

    const capturedAt = new Date().toISOString()
    assertAuthEpoch(expectedEpoch)
    const snapshot = await store.update((state) => updateFitnessCatalog(state, {
      results,
      failures,
      runId,
      attemptedAt,
      completedAt: capturedAt,
      capturedAt,
    }))
    assertAuthEpoch(expectedEpoch)
    sendSnapshot()
    return cachedFitnessResult(snapshot.dataCatalog, requestedYear || first.yearKey) || first
  }

  function isFitnessLoginPage(page) {
    return /experimental-auth-endpoint|统一身份认证|normal\/login|cas\/login/i.test(`${page?.url || ''}\n${page?.text || ''}`)
  }

  async function fitnessSessionReady() {
    try {
      return !isFitnessLoginPage(await loadFitnessBrowserPage('https://tygl.buct.edu.cn/', 2))
    } catch {
      return false
    }
  }

  async function ensureFitnessSession({ background = false, expectedEpoch = getAuthEpoch() } = {}) {
    assertAuthEpoch(expectedEpoch)
    if (await fitnessSessionReady()) {
      assertAuthEpoch(expectedEpoch)
      return true
    }
    assertAuthEpoch(expectedEpoch)
    await openLoginWindow({ background, sources: ['tygl'], expectedEpoch })
    assertAuthEpoch(expectedEpoch)
    const deadline = Date.now() + 35_000
    while (Date.now() < deadline) {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 900))
      assertAuthEpoch(expectedEpoch)
      if (await fitnessSessionReady()) {
        assertAuthEpoch(expectedEpoch)
        return true
      }
      assertAuthEpoch(expectedEpoch)
    }
    return false
  }

  return {
    fetchFitnessScoreFromSchool,
    importFitnessArchive,
    isFitnessLoginPage,
    fitnessSessionReady,
    ensureFitnessSession,
  }
}
