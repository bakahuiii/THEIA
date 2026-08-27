import { app, safeStorage, session } from 'electron'
import { appendFile, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { AcademicApiClient } from '../core/academic-api-client.mjs'
import { AcademicApiVault } from '../electron/academic-api-vault.mjs'
import { CourseSelectionService } from '../core/course-selection.mjs'
import { SessionClient } from '../core/source-client.mjs'

const output = resolve(process.env.THEIA_COURSE_SELECTION_PAGES_OUTPUT || resolve(process.env.APPDATA || '.', 'THEIA', 'course-selection', 'pages-probe.ndjson'))
const targetCode = String(process.env.THEIA_COURSE_SELECTION_PROBE_CODE || 'PSE30200T').trim().toUpperCase()
const targetTitle = String(process.env.THEIA_COURSE_SELECTION_PROBE_TITLE || '科技写作与报告').trim()
const userData = resolve(process.env.APPDATA || '.', 'THEIA')
app.setPath('userData', userData)
app.setPath('sessionData', resolve(userData, 'session'))

async function report(value) {
  const line = `${JSON.stringify({ at: new Date().toISOString(), ...value })}\n`
  await mkdir(resolve(output, '..'), { recursive: true })
  await appendFile(output, line, 'utf8')
  process.stdout.write(line)
}

function safeBlock(block) {
  return { ...block, controlSequence: block.controlSequence ? '[present]' : '' }
}

async function run() {
  const apiVault = new AcademicApiVault(userData, safeStorage)
  const credentials = await apiVault.readCredentials()
  if (!credentials) throw new Error('No saved academic API credentials')
  const apiClient = new AcademicApiClient(credentials)
  await apiClient.login()
  const schoolSession = session.fromPartition('persist:theia')
  const browserCookieUrl = 'https://jwglxt.buct.edu.cn/jwglxt/'
  const apiCookieNames = [...apiClient.cookies.keys()]
  const existing = await schoolSession.cookies.get({ url: browserCookieUrl })
  for (const cookie of existing) {
    if (apiCookieNames.includes(cookie.name)) await schoolSession.cookies.remove(browserCookieUrl, cookie.name).catch(() => undefined)
  }
  for (const [name, value] of apiClient.cookies.entries()) {
    await schoolSession.cookies.set({ url: browserCookieUrl, name, value, path: '/', secure: true, httpOnly: true })
  }
  await report({ type: 'cookie_bridge', names: apiCookieNames })
  const client = new SessionClient(schoolSession, { timeoutMs: 30_000 })
  const service = new CourseSelectionService({
    client,
    getState: () => ({ terms: [{ id: '2026-3', year: 2026, term: '3' }] }),
    onDiagnostic: (event, fields) => { void report({ type: 'diagnostic', event, ...fields }) },
  })
  const portal = await service.discover()
  await report({ type: 'portal', portal: { ...portal, context: undefined, blocks: portal.blocks.map(safeBlock) }, targetCode, targetTitle })
  for (const block of portal.blocks) {
    const found = []
    const seenPageSignatures = new Set()
    const seenCourseKeys = new Set()
    let scannedCourseCount = 0
    let total = null
    for (let page = 1; page <= 50; page += 1) {
      const result = await service.candidates(block.id, { courseCode: targetCode, title: targetTitle }, { page, pageSize: 100, search: false })
      total = result.total
      const hits = result.candidates.filter((candidate) => candidate.courseCode?.toUpperCase() === targetCode || candidate.title?.includes(targetTitle))
      found.push(...hits.map((candidate) => ({ page, candidate })))
      const signature = result.courseKeys?.join('|') || `count:${result.courseCount}`
      if (seenPageSignatures.has(signature)) {
        await report({ type: 'page', block: safeBlock(block), page, itemCount: result.courseCount, matchedCourseCount: result.matchedCourseCount, total, hits: hits.length, stop: 'repeated-page' })
        break
      }
      seenPageSignatures.add(signature)
      if (result.courseKeys?.length) {
        for (const key of result.courseKeys) seenCourseKeys.add(key)
        scannedCourseCount = seenCourseKeys.size
      } else {
        scannedCourseCount += result.courseCount || 0
      }
      await report({ type: 'page', block: safeBlock(block), page, itemCount: result.courseCount, matchedCourseCount: result.matchedCourseCount, total, hits: hits.length })
      if (!result.courseCount || (result.totalKnown && scannedCourseCount >= total)) break
    }
    await report({ type: 'summary', block: safeBlock(block), total, found })
  }
}

app.on('ready', () => {
  void run().catch(async (error) => {
    await report({ type: 'error', name: error?.name || 'Error', message: error?.message || String(error), code: error?.code || null })
    process.exitCode = 1
  }).finally(() => app.exit(process.exitCode || 0))
})
