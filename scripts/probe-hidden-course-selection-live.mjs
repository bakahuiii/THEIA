import { app, safeStorage, session } from 'electron'
import { appendFile, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { CourseSelectionService } from '../core/course-selection.mjs'
import { AcademicApiClient } from '../core/academic-api-client.mjs'
import { AcademicApiVault } from '../electron/academic-api-vault.mjs'
import { AuthRequiredError, SessionClient } from '../core/source-client.mjs'
import { cacheSchoolScheduleResult, emptyDataCatalog } from '../core/data-catalog.mjs'

const userData = resolve(process.env.APPDATA || '.', 'THEIA')
const output = resolve(process.env.THEIA_HIDDEN_SELECTION_OUTPUT || resolve(process.env.APPDATA || '.', 'THEIA', 'course-selection', 'hidden-selection-live.ndjson'))
const target = {
  termId: String(process.env.THEIA_HIDDEN_COURSE_TERM || '2026-3').trim(),
  courseId: String(process.env.THEIA_HIDDEN_COURSE_ID || 'PSE30200T').trim(),
  courseCode: String(process.env.THEIA_HIDDEN_COURSE_CODE || 'PSE30200T').trim(),
  title: String(process.env.THEIA_HIDDEN_COURSE_TITLE || '科技写作与报告').trim(),
  classId: String(process.env.THEIA_HIDDEN_CLASS_ID || '54F89D71FC0F85EEE063B99AC3798EE2').trim(),
  className: String(process.env.THEIA_HIDDEN_CLASS_NAME || '科技写作与报告-0004').trim(),
  teacher: String(process.env.THEIA_HIDDEN_COURSE_TEACHER || '王晓旭').trim(),
}

app.setPath('userData', userData)
app.setPath('sessionData', resolve(userData, 'session'))

async function report(value) {
  const line = `${JSON.stringify({ at: new Date().toISOString(), ...value })}\n`
  await mkdir(dirname(output), { recursive: true })
  await appendFile(output, line, 'utf8')
  process.stdout.write(line)
}

async function run() {
  let dataCatalog = emptyDataCatalog()
  const onDiagnostic = (event, fields) => {
    void report({ event, ...fields })
  }
  const browserSession = session.fromPartition('persist:theia')
  const browserClient = new SessionClient(browserSession, { timeoutMs: 30_000 })
  const serviceOptions = {
    getState: () => ({ dataCatalog, terms: [{ id: target.termId, year: Number(target.termId.split('-')[0]), term: target.termId.split('-').slice(1).join('-') }] }),
    onDiagnostic,
    onSchoolSchedule: async (result) => {
      dataCatalog = cacheSchoolScheduleResult(dataCatalog, result)
      await report({ type: 'schedule-cache', complete: result?.complete === true, total: result?.total || 0, targetRows: (result?.items || []).filter((item) => item.courseCode === target.courseCode && item.classId === target.classId).length })
    },
  }
  let service = new CourseSelectionService({ client: browserClient, ...serviceOptions })
  let transport = 'browser-session'
  try {
    await service.discover()
  } catch (error) {
    if (!(error instanceof AuthRequiredError) && error?.code !== 1006) throw error
    const vault = new AcademicApiVault(userData, safeStorage)
    const credentials = await vault.readCredentials()
    if (!credentials) throw error
    const api = new AcademicApiClient({ ...credentials, onDiagnostic })
    await api.login()
    service = new CourseSelectionService({
      client: browserClient,
      courseSelectionClientFactory: async () => api,
      ...serviceOptions,
    })
    await service.discover()
    transport = 'academic-api'
  }

  await report({ type: 'transport', transport })
  await report({ type: 'target', target: { ...target } })
  const schedule = await service.schoolSchedule({ termId: target.termId, forceRefresh: true })
  await report({ type: 'schedule', complete: schedule.complete === true, total: schedule.total, targetRows: schedule.items.filter((item) => item.courseCode === target.courseCode && item.classId === target.classId).length })
  const candidate = await service.findCandidate(target, (message) => { void report({ type: 'trace', message }) })
  await report({ type: 'candidate', found: true, courseCode: candidate.courseCode, classId: candidate.classId, className: candidate.className, operationIdPresent: Boolean(candidate.operationId), operationIdMatchesClassId: candidate.operationId === candidate.classId })
}

void app.whenReady()
  .then(() => run())
  .catch(async (error) => {
    await report({ type: 'error', name: error?.name || 'Error', code: error?.code || null, message: error?.message || String(error) })
    process.exitCode = 1
  })
  .finally(() => app.exit(process.exitCode || 0))
