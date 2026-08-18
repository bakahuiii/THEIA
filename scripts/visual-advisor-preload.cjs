const { contextBridge, ipcRenderer } = require('electron')

const invoke = (name, ...args) => ipcRenderer.invoke(`theia-visual:${name}`, ...args)
const readOnlyError = () => Promise.reject(new Error('视觉夹具严格只读'))
const noopSubscription = () => () => undefined

const api = {
  getSnapshot: () => invoke('get-snapshot'),
  getRendererSnapshot: () => invoke('get-renderer-snapshot'),
  getAdvisorOverview: () => invoke('get-advisor-overview'),
  getAdvisorAcademicWhatIf: (request) => invoke('get-advisor-academic-what-if', request),
  getAdvisorCourseDecisions: (request) => invoke('get-advisor-course-decisions', request),
  listAdvisorThreads: () => invoke('list-advisor-threads'),
  createAdvisorThread: () => invoke('create-advisor-thread'),
  sendAdvisorRequest: (request) => invoke('send-advisor-request', request),
  cancelAdvisorRequest: (request) => invoke('cancel-advisor-request', request),
  deleteAdvisorThread: (threadId) => invoke('delete-advisor-thread', threadId),
  getActivityLog: () => invoke('get-activity-log'),
  getAuthStatus: () => invoke('get-auth-status'),
  getCredentialStatus: () => invoke('get-credential-status'),
  getAcademicApiCredentialStatus: () => invoke('get-academic-api-credential-status'),
  getMailCredentialStatus: () => invoke('get-mail-credential-status'),
  getCourseSelection: () => invoke('get-course-selection'),
  discoverCourseSelection: () => invoke('discover-course-selection'),
  getCourseSelectionCandidates: (blockId, target, options) => invoke('get-course-selection-candidates', blockId, target, options),
  getCachedSchoolSchedule: (scope) => invoke('get-cached-school-schedule', scope),
  getAcademicCalendarAssets: () => invoke('get-academic-calendar-assets'),
  getModelStatus: () => invoke('get-model-status'),
  getApiStatus: () => invoke('get-api-status'),
  getAppearancePresets: () => invoke('get-appearance-presets'),
  windowIsMaximized: () => Promise.resolve(false),
  zoomGet: () => Promise.resolve({ level: 0, percent: 100 }),
  cancelModelRequests: () => Promise.resolve({ cancelled: 0 }),
  onSnapshot: noopSubscription,
  onSyncProgress: noopSubscription,
  onAuthStatus: noopSubscription,
  onCourseSelection: noopSubscription,
  onNewMail: noopSubscription,
  onAdvisorStream: noopSubscription,
  onAppearanceMode: noopSubscription,
}

for (const method of [
  'executeAdvisorAction', 'readSavedSecret', 'saveCredentials',
  'saveAcademicApiCredentials', 'clearCredentials', 'clearAcademicApiCredentials',
  'saveMailCredentials', 'clearMailCredentials', 'refreshMailbox', 'openMailbox',
  'readMailboxMessage', 'downloadMailboxAttachment', 'login', 'logout', 'syncNow',
  'retrySyncDomain', 'searchSchoolSchedule', 'saveCourseSelectionTarget',
  'removeCourseSelectionTarget', 'setCourseSelectionSentinel', 'startCourseSelection',
  'stopCourseSelection', 'refreshAcademicCalendarAssets', 'openSource',
  'openAssignmentSource', 'getFitnessScore', 'openSchedulePdf', 'prepareCourseWork',
  'openCourseWork', 'importCourseWorkFile', 'openSubmission', 'applyTestAnswers',
  'saveModelConfig', 'clearModelApiKey', 'validateModelConnection', 'discoverModels',
  'processCourseWorkWithModel', 'renderAnswerPdf', 'openAnswerPdf', 'summarizeNotices',
  'generateNotes', 'generatePaper', 'renderMdFile', 'exportData', 'openDataDirectory',
  'updateSettings', 'windowMinimize', 'windowMaximize', 'windowClose',
  'chooseAppBackground', 'saveAppearancePresets',
]) api[method] = readOnlyError

api.zoomSet = () => undefined
api.setAppearanceMode = () => undefined

window.addEventListener('error', (event) => {
  ipcRenderer.send('theia-visual:renderer-error', {
    kind: 'window-error',
    message: event.message,
    source: event.filename,
    line: event.lineno,
  })
})
window.addEventListener('unhandledrejection', (event) => {
  ipcRenderer.send('theia-visual:renderer-error', {
    kind: 'unhandled-rejection',
    message: event.reason instanceof Error ? event.reason.stack || event.reason.message : String(event.reason),
  })
})

contextBridge.exposeInMainWorld('theia', api)
contextBridge.exposeInMainWorld('buct', api)
