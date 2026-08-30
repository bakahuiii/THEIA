import { JWGLXT_ACTIVE_EXTRA_DOMAIN_NAMES } from '../core/jwglxt-extra.mjs'

export const SYNC_DOMAIN_TARGETS = Object.freeze({
  profile: { source: 'jwglxt', domain: 'profile' },
  terms: { source: 'jwglxt', domain: 'terms' },
  schedule: { source: 'jwglxt', domain: 'schedule' },
  exams: { source: 'jwglxt', domain: 'exams' },
  grades: { source: 'jwglxt', domain: 'grades' },
  'selected-courses': { source: 'jwglxt', domain: 'selected-courses' },
  'academic-progress': { source: 'jwglxt', domain: 'academic-progress' },
  'jwglxt-courses': { source: 'jwglxt', domain: 'courses' },
  'jwglxt-notices': { source: 'jwglxt', domain: 'notices' },
  'theol-courses': { source: 'theol', domain: 'courses' },
  'theol-course-details': { source: 'theol', domain: 'course-details' },
  'theol-notices': { source: 'theol', domain: 'notices' },
  'academic-extras': { source: 'jwglxt', domain: 'academic-extras' },
  ...Object.fromEntries(JWGLXT_ACTIVE_EXTRA_DOMAIN_NAMES.map((domain) => [domain, { source: 'jwglxt', domain }])),
})

export const FOREGROUND_JWGLXT_SYNC_DOMAINS = Object.freeze([
  'profile', 'terms', 'courses', 'schedule', 'grades', 'exams',
  'selected-courses', 'academic-progress', 'notices',
])

const STATIC_ACADEMIC_PREFETCH_DOMAINS = Object.freeze(['academic-plan'])
const ACADEMIC_STATIC_PREFETCH_DELAY_MS = 3_000
const THEOL_COURSE_DETAILS_PREFETCH_DELAY_MS = 2_500

export function createSyncOrchestrator({
  store,
  syncService,
  academicApiVault,
  academicAttachmentStore,
  verifiedSessions,
  isExplicitlyLoggedOut = () => false,
  writeDiagnostic = async () => {},
  diagnosticError = (error) => String(error?.message || error),
  sendSnapshot = () => {},
} = {}) {
  let academicStaticPrefetchTimer = null
  let academicStaticPrefetchInFlight = null
  let theolCourseDetailsPrefetchTimer = null
  let theolCourseDetailsPrefetchInFlight = null

  const loggedOut = () => Boolean(isExplicitlyLoggedOut())

  function syncForegroundCampusData() {
    const startedAt = Date.now()
    const run = (async () => {
      await writeDiagnostic('sync.foreground_started', {
        domains: FOREGROUND_JWGLXT_SYNC_DOMAINS,
        sources: ['jwglxt', 'theol'],
      })
      await Promise.all([
        syncService.syncNow({ sources: ['jwglxt'], domains: FOREGROUND_JWGLXT_SYNC_DOMAINS, foreground: true }),
        syncService.syncNow({ sources: ['theol'], domains: ['courses', 'notices'], foreground: true }),
      ])
      const snapshot = store.snapshot()
      // The terminal snapshot is also returned to the IPC caller. Sending it
      // once more covers a renderer that missed the final progress event.
      sendSnapshot()
      scheduleTheolCourseDetailsPrefetch({ reason: 'foreground_sync' })
      await writeDiagnostic('sync.foreground_finished', {
        elapsedMs: Date.now() - startedAt,
        runId: snapshot.sync?.runId || null,
        lastCompletedAt: snapshot.sync?.lastCompletedAt || null,
        lastError: snapshot.sync?.lastError || null,
      })
      return snapshot
    })()
    return run.catch(async (error) => {
      await writeDiagnostic('sync.foreground_failed', {
        elapsedMs: Date.now() - startedAt,
        error: diagnosticError(error),
      })
      throw error
    })
  }

  async function syncAdvisorCampusData({ domains } = {}) {
    const requested = Array.isArray(domains) && domains.length ? [...new Set(domains)] : null
    if (!requested) {
      const snapshot = await syncForegroundCampusData()
      return {
        scope: 'foreground',
        refreshedDomains: [...FOREGROUND_JWGLXT_SYNC_DOMAINS, 'theol-courses', 'theol-notices'],
        updatedAt: snapshot.updatedAt || null,
        revision: store.snapshotWithRevision({ clone: false }).revision,
      }
    }
    const grouped = new Map()
    for (const domain of requested) {
      const target = SYNC_DOMAIN_TARGETS[domain]
      if (!target) throw new Error(`Agent cannot synchronize unsupported domain: ${domain}`)
      const entry = grouped.get(target.source) || []
      entry.push(target.domain)
      grouped.set(target.source, entry)
    }
    await Promise.all([...grouped.entries()].map(([source, sourceDomains]) => (
      syncService.syncNow({ sources: [source], domains: [...new Set(sourceDomains)], foreground: true })
    )))
    const snapshot = store.snapshot()
    sendSnapshot()
    return {
      scope: 'selected',
      refreshedDomains: requested,
      updatedAt: snapshot.updatedAt || null,
      revision: store.snapshotWithRevision({ clone: false }).revision,
    }
  }

  async function waitForSyncIdle(timeoutMs = 60_000) {
    const deadline = Date.now() + timeoutMs
    while (syncService?.hasActiveSync?.() && Date.now() < deadline) {
      const active = syncService.active
      if (active) {
        await Promise.race([
          Promise.resolve(active).catch(() => undefined),
          new Promise((resolveWait) => setTimeout(resolveWait, 500)),
        ])
      } else {
        await new Promise((resolveWait) => setTimeout(resolveWait, 250))
      }
    }
    return !syncService?.hasActiveSync?.()
  }

  async function prefetchAcademicStaticData({ reason = 'authenticated' } = {}) {
    if (!syncService || !academicAttachmentStore || loggedOut()) return
    let apiReady = false
    if (store.snapshot().settings.academicApiEnabled && academicApiVault?.status) {
      apiReady = Boolean((await academicApiVault.status().catch(() => ({ saved: false }))).saved)
    }
    if (!verifiedSessions.jwglxt && !apiReady) return
    const initial = store.snapshot()
    const domains = initial.academicExtras?.domains || {}
    const plan = domains['academic-plan']
    // A captured plan without a verified local PDF is incomplete. This also
    // repairs older snapshots that retained only page metadata.
    const planAttachmentMissing = !Array.isArray(plan?.attachments)
      || !plan.attachments.some((attachment) => attachment?.id && attachment?.cached === true)
    const missing = []
    if (!plan?.capturedAt || planAttachmentMissing) missing.push('academic-plan')
    if (!missing.length) {
      void writeDiagnostic('sync.static_prefetch_skipped', { reason, cause: 'cache_healthy' })
      return
    }
    for (const domain of STATIC_ACADEMIC_PREFETCH_DOMAINS) {
      if (!missing.includes(domain) || loggedOut() || (!verifiedSessions.jwglxt && !apiReady)) continue
      // Foreground sync owns the same source. Wait for its commit before
      // starting the slower static artifact request.
      if (!(await waitForSyncIdle())) {
        void writeDiagnostic('sync.static_prefetch_deferred', { domain, reason: 'foreground_sync_active' })
        return
      }
      try {
        void writeDiagnostic('sync.static_prefetch_started', { domain, reason })
        await syncService.syncNow({ sources: ['jwglxt'], domains: [domain] })
        void writeDiagnostic('sync.static_prefetch_finished', { domain, reason })
      } catch (error) {
        void writeDiagnostic('sync.static_prefetch_failed', { domain, reason, error: diagnosticError(error) })
        return
      }
    }
  }

  function scheduleAcademicStaticPrefetch({ reason = 'authenticated' } = {}) {
    if (academicStaticPrefetchTimer || academicStaticPrefetchInFlight || loggedOut()) return
    academicStaticPrefetchTimer = setTimeout(() => {
      academicStaticPrefetchTimer = null
      academicStaticPrefetchInFlight = prefetchAcademicStaticData({ reason })
        .catch((error) => writeDiagnostic('sync.static_prefetch_failed', { reason, error: diagnosticError(error) }))
        .finally(() => { academicStaticPrefetchInFlight = null })
    }, ACADEMIC_STATIC_PREFETCH_DELAY_MS)
  }

  async function prefetchTheolCourseDetails({ reason = 'authenticated' } = {}) {
    if (!syncService || loggedOut() || !verifiedSessions.theol) return
    if (!(await waitForSyncIdle())) {
      void writeDiagnostic('sync.course_details_prefetch_deferred', { reason, cause: 'foreground_sync_active' })
      return
    }
    if (!store.snapshot().courses.some((item) => item?.source === 'theol')) return
    try {
      void writeDiagnostic('sync.course_details_prefetch_started', { reason })
      await syncService.syncNow({ sources: ['theol'], domains: ['course-details'] })
      void writeDiagnostic('sync.course_details_prefetch_finished', { reason })
    } catch (error) {
      void writeDiagnostic('sync.course_details_prefetch_failed', { reason, error: diagnosticError(error) })
    }
  }

  function scheduleTheolCourseDetailsPrefetch({ reason = 'authenticated' } = {}) {
    if (theolCourseDetailsPrefetchTimer || theolCourseDetailsPrefetchInFlight || loggedOut()) return
    theolCourseDetailsPrefetchTimer = setTimeout(() => {
      theolCourseDetailsPrefetchTimer = null
      theolCourseDetailsPrefetchInFlight = prefetchTheolCourseDetails({ reason })
        .finally(() => { theolCourseDetailsPrefetchInFlight = null })
    }, THEOL_COURSE_DETAILS_PREFETCH_DELAY_MS)
  }

  function shutdown() {
    if (academicStaticPrefetchTimer) clearTimeout(academicStaticPrefetchTimer)
    academicStaticPrefetchTimer = null
    if (theolCourseDetailsPrefetchTimer) clearTimeout(theolCourseDetailsPrefetchTimer)
    theolCourseDetailsPrefetchTimer = null
  }

  return {
    syncForegroundCampusData,
    syncAdvisorCampusData,
    waitForSyncIdle,
    prefetchAcademicStaticData,
    scheduleAcademicStaticPrefetch,
    prefetchTheolCourseDetails,
    scheduleTheolCourseDetailsPrefetch,
    shutdown,
  }
}
