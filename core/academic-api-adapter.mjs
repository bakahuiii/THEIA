import { JwglxtAdapter } from './adapters/jwglxt.mjs'
import { AcademicApiClient, AcademicApiError } from './academic-api-client.mjs'
import {
  degreePlanDetailsToProgress,
  hasAcademicRequirementDetails,
  mergeAcademicProgressDetails,
} from './academic-progress.mjs'
import { sourceDomainOutcome } from './domain-provenance.mjs'

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
      const result = await this.adapterFactory(client).sync(options)
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
      this.onDiagnostic('academic_api.completed', { mode: 'api' })
      return result
    } catch (error) {
      const apiError = error instanceof AcademicApiError ? error : null
      const message = error instanceof Error ? error.message : String(error)
      this.onDiagnostic('academic_api.failed_without_browser_fallback', { code: apiError?.code || 999, error: message })
      this.onProgress?.({ status: 'error', label: '教务 API 暂不可用，已保留本地数据' })
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
