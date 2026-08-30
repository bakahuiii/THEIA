import { randomUUID } from 'node:crypto'
import { AuthRequiredError, MAX_ATTACHMENT_RESPONSE_BYTES } from '../core/source-client.mjs'
import { AcademicApiClient } from '../core/academic-api-client.mjs'
import { academicPlanDocumentMatches, buildAcademicPlanDocument } from '../core/academic-plan-document.mjs'
import {
  failAcademicCalendarCatalog,
  updateAcademicCalendarCatalog,
} from '../core/catalog-provenance.mjs'

export function createAcademicCalendarRuntime({
  store,
  academicApiVault,
  academicAttachmentStore,
  academicCalendarAssetsService,
  getAcademicSessionClient = () => null,
  getSyncService = () => null,
  getCredentialVault = () => null,
  verifiedStatus,
  rememberVerifiedSession,
  assertAuthEpoch,
  openLoginWindow,
  sendSnapshot = () => {},
  writeDiagnostic = async () => {},
  diagnosticError = (error) => String(error?.message || error),
} = {}) {
  let refreshInFlight = null

  async function repairAcademicAttachment(attachment, { domain, expectedEpoch }) {
    const academicSessionClient = getAcademicSessionClient()
    if (!academicSessionClient || !academicAttachmentStore) throw new Error('教务附件服务尚未就绪')
    assertAuthEpoch(expectedEpoch)
    const sourceUrl = String(attachment?.sourceUrl || '').trim()
    if (!sourceUrl) throw new Error('官方培养计划缺少来源地址')
    const browserVerified = Boolean(await verifiedStatus('jwglxt'))
    let result = null
    let lastError = null
    const tryClient = async (client) => {
      if (!client || result) return
      try {
        result = await client.binary(sourceUrl, {
          source: '教务系统官方培养计划 PDF',
          maxBytes: MAX_ATTACHMENT_RESPONSE_BYTES,
        })
      } catch (error) {
        lastError = error
      }
      assertAuthEpoch(expectedEpoch)
    }
    // A verified browser session is the fastest path and avoids waiting for an
    // unrelated API login before showing an already-local user's document.
    if (browserVerified) await tryClient(academicSessionClient)
    if (!result && store.snapshot().settings.academicApiEnabled) {
      const credentials = academicApiVault?.readCredentials
        ? await academicApiVault.readCredentials().catch(() => null)
        : null
      if (credentials) {
        try {
          const apiClient = new AcademicApiClient(credentials)
          await apiClient.login()
          await tryClient(apiClient)
        } catch (error) {
          lastError = error
          void writeDiagnostic('jwglxt.attachment_api_login_failed', { error: diagnosticError(error) })
        }
      }
    }
    if (!result && !browserVerified) await tryClient(academicSessionClient)
    // A missing/expired browser session is the only case where authentication
    // is a useful retry. Keep it on the same foreground action.
    if (!result && (lastError instanceof AuthRequiredError || Number(lastError?.code) === 1006)) {
      const browserAdapter = getSyncService()?.jwglxt
      let browserStatus = { connected: false }
      try {
        if (typeof browserAdapter?.browserStatus === 'function') browserStatus = await browserAdapter.browserStatus()
        else if (typeof browserAdapter?.browserAdapter?.status === 'function') browserStatus = await browserAdapter.browserAdapter.status()
        else if (typeof browserAdapter?.status === 'function') browserStatus = await browserAdapter.status()
      } catch {
        browserStatus = { connected: false }
      }
      if (browserStatus?.connected) {
        await rememberVerifiedSession('jwglxt', browserStatus.url || sourceUrl, expectedEpoch)
      } else {
        const credentialVault = getCredentialVault()
        const credentials = credentialVault?.status
          ? await credentialVault.status().catch(() => ({ saved: false }))
          : { saved: false }
        const actors = await openLoginWindow({
          background: Boolean(credentials?.saved),
          sources: ['jwglxt'],
          expectedEpoch,
          requireBrowser: true,
          skipSync: true,
        })
        const actor = actors?.find?.((candidate) => candidate?.source === 'jwglxt')
        if (actor?.lifecycle) await actor.lifecycle
        assertAuthEpoch(expectedEpoch)
        if (!actor?.authenticated) throw lastError
      }
      try {
        result = await academicSessionClient.binary(sourceUrl, {
          source: '教务系统官方培养计划 PDF',
          maxBytes: MAX_ATTACHMENT_RESPONSE_BYTES,
        })
      } catch (error) {
        lastError = error
      }
    }
    if (!result) throw lastError || new Error('教务附件下载失败')
    assertAuthEpoch(expectedEpoch)
    const buffer = Buffer.isBuffer(result?.buffer) ? result.buffer : Buffer.from(result?.buffer || '')
    if (buffer.subarray(0, 5).toString('ascii') !== '%PDF-') {
      throw new Error('教务系统返回的不是有效 PDF，未写入本地')
    }
    const saved = await academicAttachmentStore.save({ id: attachment.id, extension: 'pdf', buffer, exclusive: true })
    assertAuthEpoch(expectedEpoch)
    await store.update((state) => {
      const currentDomain = state.academicExtras?.domains?.[domain]
      if (!currentDomain) return state
      const attachments = (currentDomain.attachments || []).map((item) => item?.id === attachment.id
        ? {
          ...item,
          sourceUrl: result?.url || item.sourceUrl,
          type: 'pdf',
          cached: true,
          bytes: saved.bytes,
          sha256: saved.sha256 || null,
          filename: saved.filename || null,
        }
        : item)
      return {
        ...state,
        academicExtras: {
          ...state.academicExtras,
          domains: {
            ...state.academicExtras.domains,
            [domain]: { ...currentDomain, attachments },
          },
        },
      }
    })
    if (domain === 'academic-plan') await refreshAcademicPlanDocument()
    sendSnapshot()
    void writeDiagnostic('jwglxt.attachment_repaired', {
      domain,
      attachmentId: attachment.id,
      bytes: saved.bytes,
    })
    return saved
  }

  async function refreshAcademicPlanDocument() {
    if (!store || !academicAttachmentStore) return null
    const state = store.snapshot()
    const attachment = state.academicExtras?.domains?.['academic-plan']?.attachments
      ?.find((item) => item?.id && String(item?.type || '').toLowerCase() === 'pdf')
    const clear = async () => {
      if (!store.snapshot().academicPlanDocument) return null
      await store.update((current) => ({ ...current, academicPlanDocument: null }))
      return null
    }
    if (!attachment) return clear()
    const cached = await academicAttachmentStore.find(attachment.id, 'pdf')
    if (!cached) return clear()
    try {
      const document = await buildAcademicPlanDocument({ attachment, path: cached.path })
      if (academicPlanDocumentMatches(state.academicPlanDocument, {
        attachmentId: document.sourceAttachmentId,
        sha256: document.sourceSha256,
        bytes: document.sourceBytes,
      })) return state.academicPlanDocument
      await store.update((current) => {
        const currentAttachment = current.academicExtras?.domains?.['academic-plan']?.attachments
          ?.find((item) => item?.id === attachment.id && String(item?.type || '').toLowerCase() === 'pdf')
        if (!currentAttachment) return current
        return { ...current, academicPlanDocument: document }
      })
      void writeDiagnostic('jwglxt.academic_plan_document_refreshed', {
        attachmentId: document.sourceAttachmentId,
        bytes: document.sourceBytes,
        pages: document.pageCount,
        sha256: document.sourceSha256,
      })
      return document
    } catch (error) {
      await clear()
      void writeDiagnostic('jwglxt.academic_plan_document_failed', { error: diagnosticError(error) })
      return null
    }
  }

  async function normalizeAcademicPlanAttachmentCache() {
    if (!store || !academicAttachmentStore) return
    const domain = store.snapshot().academicExtras?.domains?.['academic-plan']
    const attachment = domain?.attachments?.find((item) => item?.id && String(item?.type || '').toLowerCase() === 'pdf')
    if (!attachment) {
      await academicAttachmentStore.prunePdfFiles()
      await refreshAcademicPlanDocument()
      return
    }
    const existing = await academicAttachmentStore.find(attachment.id, 'pdf')
    if (!existing && attachment.cached !== true) {
      await academicAttachmentStore.prunePdfFiles()
      await refreshAcademicPlanDocument()
      return
    }
    await academicAttachmentStore.keepOnly({ id: attachment.id, extension: 'pdf' })
    const cached = await academicAttachmentStore.find(attachment.id, 'pdf')
    if (cached) {
      if (attachment.cached === true && attachment.bytes === cached.bytes && attachment.filename === cached.filename) {
        await refreshAcademicPlanDocument()
        return
      }
      await store.update((state) => {
        const current = state.academicExtras?.domains?.['academic-plan']
        if (!current) return state
        return {
          ...state,
          academicExtras: {
            ...state.academicExtras,
            domains: {
              ...state.academicExtras.domains,
              'academic-plan': {
                ...current,
                attachments: (current.attachments || []).map((item) => item?.id === attachment.id
                  ? { ...item, cached: true, bytes: cached.bytes, filename: cached.filename }
                  : item),
              },
            },
          },
        }
      })
      await refreshAcademicPlanDocument()
      return
    }
    if (attachment.cached !== true) return
    await store.update((state) => {
      const current = state.academicExtras?.domains?.['academic-plan']
      if (!current) return state
      return {
        ...state,
        academicExtras: {
          ...state.academicExtras,
          domains: {
            ...state.academicExtras.domains,
            'academic-plan': {
              ...current,
              completeness: 'partial',
              attachments: (current.attachments || []).map((item) => item?.id === attachment.id
                ? { ...item, cached: false, bytes: null, sha256: null, filename: null }
                : item),
            },
          },
        },
      }
    })
    await refreshAcademicPlanDocument()
  }

  function refreshAcademicCalendarAssets({ force = false, trigger = 'scheduled' } = {}) {
    if (refreshInFlight) return refreshInFlight
    if (!force && academicCalendarAssetsService && !academicCalendarAssetsService.needsRefresh()) {
      void writeDiagnostic('academic_calendar.refresh_skipped', { trigger, reason: 'cache_healthy' })
      return Promise.resolve(academicCalendarAssetsService.snapshot())
    }
    const run = (async () => {
      const startedAt = Date.now()
      const attemptedAt = new Date(startedAt).toISOString()
      const runId = randomUUID()
      try {
        const manifest = await academicCalendarAssetsService.refresh({ force })
        const completedAt = new Date().toISOString()
        await store.update((state) => updateAcademicCalendarCatalog(state, { manifest, runId, attemptedAt, completedAt }))
        sendSnapshot()
        void writeDiagnostic('academic_calendar.refresh_finished', {
          trigger,
          force,
          elapsedMs: Date.now() - startedAt,
          schoolYear: manifest.calendar?.schoolYear || null,
          assets: Object.keys(manifest.assets || {}).length,
        })
        return manifest
      } catch (error) {
        const completedAt = new Date().toISOString()
        await store.update((state) => failAcademicCalendarCatalog(state, {
          runId,
          attemptedAt,
          completedAt,
          errorCode: 'academic_calendar_refresh_failed',
        }))
        sendSnapshot()
        throw error
      }
    })()
    refreshInFlight = run
    return run.finally(() => {
      if (refreshInFlight === run) refreshInFlight = null
    })
  }

  return {
    get refreshInFlight() {
      return refreshInFlight
    },
    repairAcademicAttachment,
    refreshAcademicPlanDocument,
    normalizeAcademicPlanAttachmentCache,
    refreshAcademicCalendarAssets,
  }
}
