import { JwglxtAdapter } from './adapters/jwglxt.mjs'
import { AcademicApiClient, AcademicApiError } from './academic-api-client.mjs'
import { AuthRequiredError } from './source-client.mjs'
import {
  degreePlanDetailsToProgress,
  hasAcademicRequirementDetails,
  mergeAcademicProgressDetails,
} from './academic-progress.mjs'
import { sourceDomainOutcome } from './domain-provenance.mjs'

const JWGLXT_DOMAINS = Object.freeze([
  'profile', 'terms', 'courses', 'schedule', 'grades', 'exams',
  'selected-courses', 'academic-progress', 'notices',
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
})

function requestedDomains(options, result = null) {
  if (Array.isArray(options?.domains) && options.domains.length) return [...new Set(options.domains)]
  const reported = Object.keys(result?.domainOutcomes || {})
  return reported.length ? reported : [...JWGLXT_DOMAINS]
}

function failedDomains(result, options) {
  const domains = requestedDomains(options, result)
  return domains.filter((domain) => {
    const outcome = result?.domainOutcomes?.[domain]
    return !outcome || outcome.succeeded !== true || ['failed', 'auth-required'].includes(outcome.status)
  })
}

function mergeBrowserFallback(apiResult, browserResult, domains, apiErrors = []) {
  const merged = { ...(apiResult || {}) }
  const outcomes = { ...(apiResult?.domainOutcomes || {}) }
  for (const domain of domains) {
    const field = DOMAIN_FIELDS[domain]
    const outcome = browserResult?.domainOutcomes?.[domain]
    // Adapters include a requested field even when its read failed, but use
    // `undefined` for the payload in that case. Never let that placeholder
    // erase a useful API result while merging a partial browser fallback.
    const hasUsablePayload = field
      && Object.hasOwn(browserResult || {}, field)
      && browserResult[field] !== undefined
      && (!outcome || outcome.succeeded === true)
    if (hasUsablePayload) merged[field] = browserResult[field]
    if (outcome) outcomes[domain] = outcome
  }
  const browserFailures = domains.some((domain) => {
    const outcome = browserResult?.domainOutcomes?.[domain]
    if (outcome) return outcome.succeeded !== true
    const field = DOMAIN_FIELDS[domain]
    return !field || !Object.hasOwn(browserResult || {}, field) || browserResult?.source?.connected === false
  })
  merged.domainOutcomes = outcomes
  merged.errors = browserFailures
    ? [...new Set([...(apiErrors || []), ...(browserResult?.errors || [])])]
    : [...(browserResult?.errors || [])]
  merged.source = {
    ...(apiResult?.source || {}),
    ...(browserResult?.source || {}),
    connected: apiResult?.source?.connected === true || browserResult?.source?.connected === true,
    checkedAt: browserResult?.source?.checkedAt || apiResult?.source?.checkedAt || new Date().toISOString(),
    errors: merged.errors,
  }
  return { merged, browserFailures }
}

export class AcademicApiFirstAdapter {
  constructor({ browserAdapter, credentialVault, isEnabled, onDiagnostic = () => {}, clientFactory = (credentials) => new AcademicApiClient(credentials), adapterFactory = (client) => new JwglxtAdapter(client, { academicProgressSource: 'api' }) }) {
    this.browserAdapter = browserAdapter
    this.credentialVault = credentialVault
    this.isEnabled = isEnabled
    this.onDiagnostic = onDiagnostic
    this.clientFactory = clientFactory
    this.adapterFactory = adapterFactory
    this.onProgress = null
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

  async fallbackToBrowser(result, options, domains, apiErrors = []) {
    if (!domains.length || !this.browserAdapter?.sync) return result
    this.onDiagnostic('academic_api.browser_fallback_started', { domains })
    try {
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
      await client.login()
      let result = await this.adapterFactory(client).sync(options)
      let apiFailedDomains = failedDomains(result, options)
      // A direct API session can be displaced or rejected for one endpoint
      // while the login and the other domains still succeed. Re-authenticate
      // once and retry the failed domain batch instead of surfacing a generic
      // `grades_read_failed` result to the user.
      if (apiFailedDomains.length && typeof client.login === 'function') {
        this.onDiagnostic('academic_api.retry_after_session_error', { domains: apiFailedDomains })
        try {
          await client.login()
          const retry = await this.adapterFactory(client).sync(options)
          const retryFailed = Object.values(retry.domainOutcomes || {}).some((outcome) => (
            outcome?.attempted && outcome?.succeeded === false && ['failed', 'auth-required'].includes(outcome.status)
          ))
          if (!retryFailed || !(retry.errors || []).some((entry) => /\u4f1a\u8bdd\u5df2\u5931\u6548|session.*(?:expired|invalid)|auth(?:entication)?/iu.test(String(entry)))) {
            result = retry
            this.onDiagnostic('academic_api.session_retry_succeeded')
          }
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
