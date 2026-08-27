import { app, safeStorage, session } from 'electron'
import { appendFile, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { CourseSelectionService } from '../core/course-selection.mjs'
import { AcademicApiClient } from '../core/academic-api-client.mjs'
import { AcademicApiVault } from '../electron/academic-api-vault.mjs'
import { SessionClient } from '../core/source-client.mjs'

const BASE = 'https://jwglxt.buct.edu.cn/jwglxt/'
const indexUrl = new URL('xsxk/zzxkyzb_cxZzxkYzbIndex.html?gnmkdm=N253512&layout=default', BASE).toString()
const probeCode = String(process.env.THEIA_COURSE_SELECTION_PROBE_CODE || 'PSE30200T').trim()
const probeTitle = String(process.env.THEIA_COURSE_SELECTION_PROBE_TITLE || '科技写作与报告').trim()
const probeTarget = process.env.THEIA_COURSE_SELECTION_PROBE_NO_FILTER === '1'
  ? null
  : { courseCode: probeCode, title: probeTitle }
const output = process.env.THEIA_COURSE_SELECTION_INSPECT_OUTPUT
  ? resolve(process.env.THEIA_COURSE_SELECTION_INSPECT_OUTPUT)
  : resolve(process.env.APPDATA || '.', 'THEIA', 'course-selection', 'live-inspect.ndjson')

async function report(value) {
  const line = `${JSON.stringify({ at: new Date().toISOString(), ...value })}\n`
  await mkdir(resolve(output, '..'), { recursive: true })
  await appendFile(output, line, 'utf8')
  process.stdout.write(line)
}

function safePortal(portal) {
  return {
    ...portal,
    blocks: (portal?.blocks || []).map((block) => ({
      ...block,
      controlSequence: block.controlSequence ? '[present]' : block.controlSequence,
    })),
  }
}

// The standalone Electron runner defaults to %APPDATA%\\Electron. Point it
// at THEIA's existing profile so the probe uses the user's real session.
const userData = resolve(process.env.APPDATA || '.', 'THEIA')
app.setPath('userData', userData)
app.setPath('sessionData', resolve(userData, 'session'))

async function run() {
  try {
    const schoolSession = session.fromPartition('persist:theia')
    const diagnostics = []
    const onDiagnostic = (event, fields) => {
      const entry = { event, ...fields }
      diagnostics.push(entry)
      void report(entry)
    }

    // The browser profile may have an expired SSO cookie while the separately
    // saved API account is still valid. Seed only the browser session cookies
    // from that read-only API login so the probe can inspect the rendered
    // portal without opening a login window or posting a selection.
    const apiVault = new AcademicApiVault(userData, safeStorage)
    const credentials = await apiVault.readCredentials()
    if (credentials) {
      const apiClient = new AcademicApiClient({ ...credentials, onDiagnostic })
      await apiClient.login()
      const browserCookieUrl = 'https://jwglxt.buct.edu.cn/jwglxt/'
      const apiCookieNames = [...apiClient.cookies.keys()]
      const existing = await schoolSession.cookies.get({ url: browserCookieUrl })
      for (const cookie of existing) {
        if (apiCookieNames.includes(cookie.name)) {
          await schoolSession.cookies.remove(browserCookieUrl, cookie.name).catch(() => undefined)
        }
      }
      for (const [name, value] of apiClient.cookies.entries()) {
        await schoolSession.cookies.set({ url: browserCookieUrl, name, value, path: '/', secure: true, httpOnly: true })
      }
      await report({ type: 'cookie_bridge', names: apiCookieNames })
    } else {
      await report({ type: 'cookie_bridge', names: [], skipped: true })
    }

    const client = new SessionClient(schoolSession, { timeoutMs: 30_000 })
    const service = new CourseSelectionService({
      client,
      getState: () => ({ terms: [{ id: '2026-3', year: 2026, term: '3' }] }),
      onDiagnostic,
    })

    const portal = await service.discover()
    await report({ type: 'portal', portal: safePortal({ ...portal, context: undefined }) })
    for (const block of portal.blocks) {
      const result = await service.candidates(block.id, probeTarget, { page: 1, pageSize: 100 })
      await report({ type: 'result', block, total: result.total, candidates: result.candidates, message: result.message, responseSignal: result.responseSignal })
    }
  } catch (error) {
    await report({ type: 'error', name: error?.name || 'Error', message: error?.message || String(error), code: error?.code || null, url: error?.url || null })
    process.exitCode = 1
  } finally {
    app.exit(process.exitCode || 0)
  }
}

// Electron 43 can terminate a top-level-await entrypoint before the
// app.whenReady() continuation runs. The ready event keeps this diagnostic
// runner alive until its read-only requests have completed.
app.on('ready', () => { void run() })
