import { compactError, stableId } from '../util.mjs'
import { AuthRequiredError } from '../source-client.mjs'
import { parseJwAcademicProgress, parseJwHomepage } from '../parsers/jwglxt.mjs'
import { academicPlanNodes, readAcademicProgressDetails } from '../academic-api-client.mjs'
import { degreePlanDetailsToProgress, mergeAcademicProgressDetails } from '../academic-progress.mjs'
import { BROWSER_SCHEDULE_ENDPOINT, requirementTreeHasCourses, unifiedLoginUrl } from './jwglxt-helpers.mjs'
import { JWGLXT_EXTRA_METHODS } from './jwglxt-extra-runtime.mjs'
import { JWGLXT_SYNC_METHODS } from './jwglxt-sync-runtime.mjs'
export { buildFreeClassroomQuery, buildWeeklyScheduleQuery } from './jwglxt-helpers.mjs'

const BASE = 'https://jwglxt.buct.edu.cn/jwglxt/'
const HOME = new URL('xtgl/index_initMenu.html', BASE).toString()
const ACADEMIC_PROGRESS = new URL('xsxy/xsxyqk_cxXsxyqkIndex.html?gnmkdm=N105515&layout=default', BASE).toString()

export class JwglxtAdapter {
  constructor(client, {
    onProgress,
    onDiagnostic,
    academicProgressSource = 'browser',
    scheduleEndpoints = [BROWSER_SCHEDULE_ENDPOINT],
    attachmentStore = null,
  } = {}) {
    this.client = client
    this.onProgress = onProgress || null
    this.onDiagnostic = onDiagnostic || client?.diagnostic?.bind(client) || (() => {})
    this.academicProgressSource = academicProgressSource === 'api' ? 'api' : 'browser'
    this.attachmentStore = attachmentStore && typeof attachmentStore.save === 'function' ? attachmentStore : null
    this.scheduleEndpoints = [...new Set((Array.isArray(scheduleEndpoints) ? scheduleEndpoints : [scheduleEndpoints])
      .filter((endpoint) => typeof endpoint === 'string' && endpoint.trim()))]
    if (!this.scheduleEndpoints.length) this.scheduleEndpoints = [BROWSER_SCHEDULE_ENDPOINT]
    this.academicProgressDiagnostics = null
    this.client.setDiagnostic?.(this.onDiagnostic)
  }

  async status() {
    const checkedAt = new Date().toISOString()
    try {
      const result = await this.client.page(HOME, { source: 'Academic system' })
      const parsed = parseJwHomepage(result.text, result.url)
      if (!parsed.loggedIn) throw new AuthRequiredError('Academic system', result.url)
      return { connected: true, checkedAt, url: result.url, profile: parsed.profile }
    } catch (error) {
      return { connected: false, checkedAt, authRequired: error instanceof AuthRequiredError, error: compactError(error) }
    }
  }

  // This page is the official source for the full degree-plan hierarchy,
  // including courses that are planned but not yet taken.
  async fetchAcademicProgress({ capturedAt = new Date().toISOString() } = {}) {
    this.onProgress?.({ stage: 'academic-progress', status: 'syncing', label: 'Reading degree requirements...' })
    const page = await this.client.page(ACADEMIC_PROGRESS, { source: 'Academic progress' })
    const direct = parseJwAcademicProgress(page.text, { sourceUrl: page.url, capturedAt })
    const recovered = Array.isArray(direct.roots) && direct.roots.length
      ? direct
      : academicPlanNodes(page.text, page.url).progress
    if (Array.isArray(recovered.roots) && recovered.roots.length && requirementTreeHasCourses(recovered)) {
      const progress = {
        ...recovered,
        capturedAt,
        requirementSource: recovered === direct
          ? `${this.academicProgressSource}-dom-tree`
          : `${this.academicProgressSource}-embedded-tree`,
      }
      this.academicProgressDiagnostics = {
        strategy: progress.requirementSource,
        categories: progress.categories?.length || 0,
        roots: progress.roots.length,
        detailRequests: 0,
        detailErrors: 0,
      }
      this.client.diagnostic?.('academic_progress.tree_loaded', this.academicProgressDiagnostics)
      return progress
    }

    this.onProgress?.({ stage: 'academic-progress', status: 'syncing', label: '正在补全培养方案节点…' })
    const details = await readAcademicProgressDetails(this.client, { page, concurrency: 4 })
    const detailed = degreePlanDetailsToProgress(recovered, details, {
      treeSource: `${this.academicProgressSource}-tree-detail`,
      inferredSource: `${this.academicProgressSource}-inferred-tree`,
      capturedAt,
    })
    const progress = detailed ? mergeAcademicProgressDetails(recovered, detailed) : recovered
    this.academicProgressDiagnostics = {
      strategy: progress?.requirementSource || 'summary-only',
      categories: progress?.categories?.length || 0,
      roots: progress?.roots?.length || 0,
      detailRequests: details.nodeCount || 0,
      detailLoaded: details.details.length,
      detailErrors: details.errors.length,
    }
    this.client.diagnostic?.('academic_progress.tree_fallback', this.academicProgressDiagnostics)
    return progress
  }

}

Object.assign(JwglxtAdapter.prototype, JWGLXT_EXTRA_METHODS, JWGLXT_SYNC_METHODS)


export const JWGLXT_URLS = {
  base: BASE,
  home: HOME,
  login: unifiedLoginUrl(),
  schedule: new URL('kbcx/xskbcx_cxXskbcxIndex.html?gnmkdm=N2151&layout=default', BASE).toString(),
  academicStatus: ACADEMIC_PROGRESS,
  selectedCourses: new URL('xsxxxggl/xsxxwh_cxXsxkxx.html?gnmkdm=N100801', BASE).toString(),
  notices: new URL('xtgl/index_cxDbsy.html?doType=query', BASE).toString(),
  grades: new URL('cjcx/cjcx_cxDgXscj.html?gnmkdm=N305005&layout=default', BASE).toString(),
  exams: new URL('kwgl/kscx_cxXsksxxIndex.html?gnmkdm=N358105&layout=default', BASE).toString(),
}
