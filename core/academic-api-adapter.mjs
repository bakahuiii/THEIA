import { JwglxtAdapter } from './adapters/jwglxt.mjs'
import { AcademicApiClient, AcademicApiError } from './academic-api-client.mjs'
import { AuthRequiredError } from './source-client.mjs'
import {
  degreePlanDetailsToProgress,
  hasAcademicRequirementDetails,
  mergeAcademicProgressDetails,
} from './academic-progress.mjs'
import { sourceDomainOutcome } from './domain-provenance.mjs'
import { JWGLXT_ACTIVE_EXTRA_DOMAIN_NAMES } from './jwglxt-extra.mjs'
import { normalizeSyncPayload } from './schema.mjs'

const JWGLXT_FAST_DOMAINS = Object.freeze([
  'profile', 'terms', 'courses', 'schedule', 'grades', 'exams',
  'selected-courses', 'academic-progress', 'notices',
])
const JWGLXT_DOMAINS = Object.freeze([
  ...JWGLXT_FAST_DOMAINS,
  ...JWGLXT_ACTIVE_EXTRA_DOMAIN_NAMES,
])

const DOMAIN_FIELDS = Object.freeze({
  profile: 'profile',
  terms: 'terms',
  courses: 'courses',
  schedule: 'schedule',
  grades: 'grades',
  exams: 'exams',
  'selected-courses': 'selectedCourses',
  'academic-progress': 'academicProgress',
  notices: 'notices',
  ...Object.fromEntries(JWGLXT_ACTIVE_EXTRA_DOMAIN_NAMES.map((domain) => [domain, 'academicExtras'])),
})

function requestedDomains(options, result = null) {
  const requested = Array.isArray(options?.domains) && options.domains.length
    ? [...new Set(options.domains)]
    : Object.keys(result?.domainOutcomes || {})
  // Browser fallback must preserve the caller's normal fast-path scope. A
  // failed API login must not silently turn into a broad extra-domain crawl.
  const domains = requested.length ? requested : [...JWGLXT_FAST_DOMAINS]
  if (!domains.includes('academic-extras')) return domains
  return [...new Set([
    ...domains.filter((domain) => domain !== 'academic-extras'),
    ...JWGLXT_ACTIVE_EXTRA_DOMAIN_NAMES,
  ])]
}

function failedDomains(result, options) {
  const domains = requestedDomains(options, result)
  return domains.filter((domain) => {
    const outcome = result?.domainOutcomes?.[domain]
    return !outcome || outcome.succeeded !== true || ['failed', 'auth-required'].includes(outcome.status)
  })
}

function mergeBrowserFallback(apiResult, browserResult, domains, apiErrors = []) {
  const api = normalizeSyncPayload(apiResult) || {}
  const browser = normalizeSyncPayload(browserResult) || {}
  const merged = { ...api }
  const outcomes = { ...(api.domainOutcomes || {}) }
  for (const domain of domains) {
    const field = DOMAIN_FIELDS[domain]
    const outcome = browser.domainOutcomes?.[domain]
    // Adapters include a requested field even when its read failed, but use
    // `undefined` for the payload in that case. Never let that placeholder
    // erase a useful API result while merging a partial browser fallback.
    const hasUsablePayload = field
      && Object.hasOwn(browser, field)
      && browser[field] !== undefined
      && (!outcome || outcome.succeeded === true)
    if (hasUsablePayload) {
      if (field === 'academicExtras' && browser.academicExtras?.domains?.[domain] !== undefined) {
        merged.academicExtras = {
          ...(merged.academicExtras || {}),
          ...browser.academicExtras,
          domains: {
            ...(merged.academicExtras?.domains || {}),
            [domain]: browser.academicExtras.domains[domain],
          },
        }
      } else {
        merged[field] = browser[field]
      }
    }
    if (outcome) outcomes[domain] = outcome
  }
  const browserFailures = domains.some((domain) => {
    const outcome = browser.domainOutcomes?.[domain]
    if (outcome) return outcome.succeeded !== true
    const field = DOMAIN_FIELDS[domain]
    return !field || !Object.hasOwn(browser, field) || browser.source?.connected === false
  })
  merged.domainOutcomes = outcomes
  merged.errors = browserFailures
    ? [...new Set([...(apiErrors || []), ...(browser.errors || [])])]
    : [...(browser.errors || [])]
  merged.source = {
    ...(api.source || {}),
    ...(browser.source || {}),
    connected: api.source?.connected === true || browser.source?.connected === true,
    checkedAt: browser.source?.checkedAt || api.source?.checkedAt || new Date().toISOString(),
    errors: merged.errors,
  }
  return { merged, browserFailures }
}

function mergeApiRetryResult(apiResult, retryResult, domains) {
  const api = normalizeSyncPayload(apiResult) || {}
  const retry = normalizeSyncPayload(retryResult) || {}
  const merged = { ...api }
  const outcomes = { ...(api.domainOutcomes || {}) }
  const retryFailures = []
  for (const domain of domains) {
    const field = DOMAIN_FIELDS[domain]
    const retryOutcome = retry.domainOutcomes?.[domain]
    const primaryOutcome = api.domainOutcomes?.[domain]
    const retrySucceeded = retryOutcome?.succeeded === true
    const retryHasPayload = field
      && Object.hasOwn(retry, field)
      && retry[field] !== undefined
    if (retrySucceeded && retryHasPayload) {
      if (field === 'academicExtras' && retry.academicExtras?.domains?.[domain] !== undefined) {
        merged.academicExtras = {
          ...(merged.academicExtras || {}),
          ...retry.academicExtras,
          domains: {
            ...(merged.academicExtras?.domains || {}),
            [domain]: retry.academicExtras.domains[domain],
          },
        }
      } else {
        merged[field] = retry[field]
      }
    }
    if (retryOutcome) {
      if (retrySucceeded || primaryOutcome?.succeeded !== true) outcomes[domain] = retryOutcome
      if (!retrySucceeded) retryFailures.push(domain)
    } else if (primaryOutcome?.succeeded !== true) {
      retryFailures.push(domain)
    }
  }
  merged.domainOutcomes = outcomes
  // A successful retry supersedes the original session-error list for the
  // domains it repaired. Keep both lists when a retry remains partial so the
  // diagnostics still explain retained local data.
  merged.errors = retryFailures.length
    ? [...new Set([...(api.errors || []), ...(retry.errors || [])])]
    : [...(retry.errors || [])]
  merged.source = {
    ...(api.source || {}),
    ...(retry.source || {}),
    connected: api.source?.connected === true || retry.source?.connected === true,
    checkedAt: retry.source?.checkedAt || api.source?.checkedAt || new Date().toISOString(),
    errors: merged.errors,
  }
  return merged
}

export class AcademicApiFirstAdapter {
  constructor({ browserAdapter, credentialVault, isEnabled, onDiagnostic = () => {}, clientFactory = (credentials) => new AcademicApiClient(credentials), adapterFactory = (client) => new JwglxtAdapter(client, {
    academicProgressSource: 'api',
    // BUCT's direct API returns canonical timetable rows from this endpoint.
    // Retain the browser endpoint as a compatibility fallback for older nodes.
    scheduleEndpoints: ['kbcx/xskbcx_cxXsKb.html?gnmkdm=N2151', 'kbcx/xskbcx_cxXsgrkb.html'],
  }) }) {
    this.browserAdapter = browserAdapter
    this.credentialVault = credentialVault
    this.isEnabled = isEnabled
    this.onDiagnostic = onDiagnostic
    this.clientFactory = clientFactory
    this.adapterFactory = adapterFactory
    this.onProgress = null
    this.onDomainResult = null
  }

  async status() {
    if (!this.isEnabled()) return this.browserAdapter.status()
    const credentials = await this.credentialVault.readCredentials()
    if (!credentials) return this.browserAdapter.status()
    // Direct API authentication invalidates JWGLXT's browser JSESSIONID for
    // this account. When API mode is configured, browser status must not drive
    // automatic SSO recovery or the two sessions will continually evict each
    // other. Login failures are reported by sync(), not status polling.
    return {
      connected: true,
      checkedAt: new Date().toISOString(),
      mode: 'api',
      configured: true,
    }
  }

  // API credentials authenticate a separate cookie jar. Callers that need to
  // open a real browser page must explicitly check the rendered browser
  // session instead of treating the API configuration as page authentication.
  async browserStatus() {
    return this.browserAdapter.status()
  }

  async fallbackToBrowser(result, options, domains, apiErrors = []) {
    if (!domains.length || !this.browserAdapter?.sync) return result
    this.onDiagnostic('academic_api.browser_fallback_started', { domains })
    try {
      this.browserAdapter.onDomainResult = this.onDomainResult
      const browserResult = await this.browserAdapter.sync({ ...options, domains })
      const { merged, browserFailures } = mergeBrowserFallback(result, browserResult, domains, apiErrors)
      merged.source = {
        ...(merged.source || {}),
        api: {
          ...(result?.source?.api || {}),
          enabled: true,
          used: true,
          fallback: true,
          fallbackDomains: domains,
        },
      }
      this.onDiagnostic(browserFailures ? 'academic_api.browser_fallback_partial' : 'academic_api.browser_fallback_succeeded', { domains })
      return merged
    } catch (error) {
      this.onDiagnostic('academic_api.browser_fallback_failed', {
        domains,
        error: error instanceof Error ? error.message : String(error),
      })
      // Let SyncService start platform-scoped SSO recovery instead of
      // converting an expired browser session into source_sync_failed.
      if (error instanceof AuthRequiredError || error?.name === 'AuthRequiredError') throw error
      return result
    }
  }

  async sync(options = {}) {
    this.browserAdapter.onProgress = this.onProgress
    this.browserAdapter.onDomainResult = this.onDomainResult
    const wantsAcademicProgress = options.domains === undefined || options.domains.includes('academic-progress')
    if (!this.isEnabled()) return this.browserAdapter.sync(options)
    const credentials = await this.credentialVault.readCredentials()
    if (!credentials) {
      this.onDiagnostic('academic_api.unavailable', { reason: 'credentials_missing' })
      return this.browserAdapter.sync(options)
    }
    try {
      this.onProgress?.({ status: 'syncing', label: '正在通过教务 API 读取数据' })
      const client = this.clientFactory(credentials)
      client.setDiagnostic?.(this.onDiagnostic)
      await client.login()
      const createAdapter = () => {
        const adapter = this.adapterFactory(client)
        adapter.onDiagnostic = this.onDiagnostic
        adapter.onDomainResult = this.onDomainResult
        client.setDiagnostic?.(this.onDiagnostic)
        return adapter
      }
      let result = await createAdapter().sync(options)
      let apiFailedDomains = failedDomains(result, options)
      // A direct API session can be displaced or rejected for one endpoint
      // while the login and the other domains still succeed. Re-authenticate
      // once and retry only the failed domains. The first successful payload
      // must remain authoritative if the retry is weaker or fails again.
      if (apiFailedDomains.length && typeof client.login === 'function') {
        this.onDiagnostic('academic_api.retry_after_session_error', { domains: apiFailedDomains })
        try {
          await client.login()
          const retry = await createAdapter().sync({ ...options, domains: apiFailedDomains })
          result = mergeApiRetryResult(result, retry, apiFailedDomains)
          const remaining = failedDomains(result, options)
          this.onDiagnostic(remaining.length ? 'academic_api.session_retry_partial' : 'academic_api.session_retry_succeeded', {
            domains: apiFailedDomains,
            remaining,
          })
        } catch (retryError) {
          this.onDiagnostic('academic_api.session_retry_failed', { error: retryError instanceof Error ? retryError.message : String(retryError) })
        }
      }
      apiFailedDomains = failedDomains(result, options)
      const sessionExpiredErrors = (result.errors || []).filter((entry) => /\u4f1a\u8bdd\u5df2\u5931\u6548/.test(String(entry)))
      if (sessionExpiredErrors.length && result.source?.connected) {
        result.source.diagnostics = { ...result.source.diagnostics, partialSessionErrors: sessionExpiredErrors }
        this.onDiagnostic('academic_api.partial_session_errors', { count: sessionExpiredErrors.length })
      }
      const requirementSource = String(result.academicProgress?.requirementSource || '')
      const hasRequirementTree = Array.isArray(result.academicProgress?.roots) && result.academicProgress.roots.length > 0
      let academicProgressSource = requirementSource.endsWith('inferred-tree')
        ? 'api-inferred-tree'
        : hasRequirementTree
          ? 'api-detail'
          : 'summary-only'
      if (wantsAcademicProgress && !hasRequirementTree) {
        academicProgressSource = 'summary-only'
        this.onDiagnostic('academic_api.academic_progress_summary_only', { hasGpa: result.academicProgress?.gpa != null })
        try {
          this.onProgress?.({ status: 'syncing', label: 'Reading API degree requirement details...' })
          const detailResult = await client.academicProgressDetails()
          const detailedProgress = degreePlanDetailsToProgress(result.academicProgress, detailResult)
          if (hasAcademicRequirementDetails(detailedProgress)) {
            result.academicProgress = mergeAcademicProgressDetails(result.academicProgress, detailedProgress)
            if (Array.isArray(result.academicProgress.roots) && result.academicProgress.roots.length) {
              const previousOutcome = result.domainOutcomes?.['academic-progress']
              const inferred = String(result.academicProgress.requirementSource || '').endsWith('inferred-tree')
              const partialDetails = Array.isArray(detailResult.errors) && detailResult.errors.length > 0
              result.domainOutcomes = {
                ...(result.domainOutcomes || {}),
                'academic-progress': sourceDomainOutcome({
                  ...previousOutcome,
                  source: previousOutcome?.source || 'jwglxt',
                  attempted: true,
                  succeeded: true,
                  status: 'succeeded',
                  capturedAt: previousOutcome?.capturedAt || result.academicProgress.capturedAt || null,
                  completeness: inferred || partialDetails ? 'partial' : 'complete',
                  emptyConfirmed: false,
                  contentEmptyConfirmed: false,
                  parserVersion: previousOutcome?.parserVersion || result.parserVersion || null,
                  errorCode: inferred
                    ? 'requirement_tree_inferred'
                    : partialDetails
                      ? 'partial_requirement_details'
                      : null,
                }),
              }
            }
            academicProgressSource = result.academicProgress.requirementSource === 'api-inferred-tree'
              ? 'api-inferred-tree'
              : 'api-detail'
            this.onDiagnostic('academic_api.academic_progress_details_loaded', {
              roots: result.academicProgress.roots?.length || 0,
              categories: result.academicProgress.categories?.length || 0,
              partialErrors: detailResult.errors?.length || 0,
            })
          } else {
            this.onDiagnostic('academic_api.academic_progress_details_empty')
          }
        } catch (error) {
          this.onDiagnostic('academic_api.academic_progress_details_failed', {
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }
      result.source = {
        ...result.source,
        api: {
          enabled: true,
          used: true,
          fallback: false,
          academicProgress: academicProgressSource,
        },
      }
      if (apiFailedDomains.length) {
        return this.fallbackToBrowser(result, options, apiFailedDomains, result.errors || [])
      }
      this.onDiagnostic('academic_api.completed', { mode: 'api' })
      return result
    } catch (error) {
      const apiError = error instanceof AcademicApiError ? error : null
      const message = error instanceof Error ? error.message : String(error)
      this.onDiagnostic('academic_api.failed', { code: apiError?.code || 999, error: message })
      this.onProgress?.({ status: 'error', label: '教务 API 暂不可用，已保留本地数据' })
      const browserFallback = await this.fallbackToBrowser({
        errors: [message],
        source: {
          connected: false,
          checkedAt: new Date().toISOString(),
          error: message,
          api: { enabled: true, used: false, fallback: false, code: apiError?.code || 999 },
        },
      }, options, requestedDomains(options), [message])
      if (browserFallback?.source?.api?.fallback) return browserFallback
      return {
        errors: [message],
        source: {
          connected: false,
          checkedAt: new Date().toISOString(),
          error: message,
          api: { enabled: true, used: false, fallback: false, code: apiError?.code || 999 },
        },
      }
    }
  }
}
