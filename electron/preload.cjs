const { contextBridge, ipcRenderer } = require('electron')

const api = {
  getSnapshot: () => ipcRenderer.invoke('theia:get-snapshot'),
  getAdvisorOverview: () => ipcRenderer.invoke('theia:advisor:get-overview'),
  getActivityLog: () => ipcRenderer.invoke('theia:get-activity-log'),
  getAuthStatus: () => ipcRenderer.invoke('theia:get-auth-status'),
  getCredentialStatus: () => ipcRenderer.invoke('theia:get-credential-status'),
  getAcademicApiCredentialStatus: () => ipcRenderer.invoke('theia:get-academic-api-credential-status'),
  getMailCredentialStatus: () => ipcRenderer.invoke('theia:get-mail-credential-status'),
  readSavedSecret: (kind) => ipcRenderer.invoke('theia:read-saved-secret', kind),
  saveCredentials: (credentials) => ipcRenderer.invoke('theia:save-credentials', credentials),
  saveAcademicApiCredentials: (credentials) => ipcRenderer.invoke('theia:save-academic-api-credentials', credentials),
  clearCredentials: () => ipcRenderer.invoke('theia:clear-credentials'),
  clearAcademicApiCredentials: () => ipcRenderer.invoke('theia:clear-academic-api-credentials'),
  saveMailCredentials: (credentials) => ipcRenderer.invoke('theia:save-mail-credentials', credentials),
  clearMailCredentials: () => ipcRenderer.invoke('theia:clear-mail-credentials'),
  refreshMailbox: () => ipcRenderer.invoke('theia:refresh-mailbox'),
  openMailbox: () => ipcRenderer.invoke('theia:open-mailbox'),
  readMailboxMessage: (id, options) => ipcRenderer.invoke('theia:read-mailbox-message', id, options),
  downloadMailboxAttachment: (id, index) => ipcRenderer.invoke('theia:download-mailbox-attachment', id, index),
  login: () => ipcRenderer.invoke('theia:login'),
  logout: () => ipcRenderer.invoke('theia:logout'),
  syncNow: () => ipcRenderer.invoke('theia:sync-now'),
  retrySyncDomain: (domain) => ipcRenderer.invoke('theia:sync-domain', domain),
  getCourseSelection: () => ipcRenderer.invoke('theia:get-course-selection'),
  discoverCourseSelection: () => ipcRenderer.invoke('theia:discover-course-selection'),
  getCourseSelectionCandidates: (blockId, target, options) => ipcRenderer.invoke('theia:get-course-selection-candidates', blockId, target, options),
  searchSchoolSchedule: (query) => ipcRenderer.invoke('theia:search-school-schedule', query),
  getCachedSchoolSchedule: (scope) => ipcRenderer.invoke('theia:get-cached-school-schedule', scope),
  saveCourseSelectionTarget: (target) => ipcRenderer.invoke('theia:save-course-selection-target', target),
  removeCourseSelectionTarget: (id) => ipcRenderer.invoke('theia:remove-course-selection-target', id),
  setCourseSelectionSentinel: (config) => ipcRenderer.invoke('theia:set-course-selection-sentinel', config),
  startCourseSelection: (options) => ipcRenderer.invoke('theia:start-course-selection', options),
  stopCourseSelection: () => ipcRenderer.invoke('theia:stop-course-selection'),
  getAcademicCalendarAssets: () => ipcRenderer.invoke('theia:get-academic-calendar-assets'),
  refreshAcademicCalendarAssets: (options) => ipcRenderer.invoke('theia:refresh-academic-calendar-assets', options),
  openSource: (url) => ipcRenderer.invoke('theia:open-source', url),
  openAssignmentSource: (assignmentId) => ipcRenderer.invoke('theia:open-assignment-source', assignmentId),
  getFitnessScore: (year, options) => ipcRenderer.invoke('theia:get-fitness-score', year, options),
  openSchedulePdf: () => ipcRenderer.invoke('theia:open-schedule-pdf'),
  prepareCourseWork: (assignmentId) => ipcRenderer.invoke('theia:prepare-course-work', assignmentId),
  openCourseWork: (assignmentId) => ipcRenderer.invoke('theia:open-course-work', assignmentId),
  importCourseWorkFile: (assignmentId, kind) => ipcRenderer.invoke('theia:import-course-work-file', assignmentId, kind),
  openSubmission: (assignmentId) => ipcRenderer.invoke('theia:open-submission', assignmentId),
  applyTestAnswers: (assignmentId) => ipcRenderer.invoke('theia:apply-test-answers', assignmentId),
  getModelStatus: () => ipcRenderer.invoke('theia:get-model-status'),
  saveModelConfig: (config) => ipcRenderer.invoke('theia:save-model-config', config),
  clearModelApiKey: () => ipcRenderer.invoke('theia:clear-model-api-key'),
  cancelModelRequests: () => ipcRenderer.invoke('theia:cancel-model-requests'),
  validateModelConnection: () => ipcRenderer.invoke('theia:validate-model-connection'),
  discoverModels: (config) => ipcRenderer.invoke('theia:discover-models', config),
  processCourseWorkWithModel: (assignmentId) => ipcRenderer.invoke('theia:process-course-work-with-model', assignmentId),
  renderAnswerPdf: (assignmentId) => ipcRenderer.invoke('theia:render-answer-pdf', assignmentId),
  openAnswerPdf: (assignmentId) => ipcRenderer.invoke('theia:open-answer-pdf', assignmentId),
  summarizeNotices: () => ipcRenderer.invoke('theia:summarize-notices'),
  generateNotes: (assignmentId, options) => ipcRenderer.invoke('theia:generate-notes', assignmentId, options),
  generatePaper: (assignmentId, options) => ipcRenderer.invoke('theia:generate-paper', assignmentId, options),
  renderMdFile: (assignmentId, fileKey) => ipcRenderer.invoke('theia:render-md-file', assignmentId, fileKey),
  exportData: (format, collection) => ipcRenderer.invoke('theia:export-data', { format, collection }),
  openDataDirectory: () => ipcRenderer.invoke('theia:open-data-directory'),
  getApiStatus: () => ipcRenderer.invoke('theia:get-api-status'),
  updateSettings: (settings) => ipcRenderer.invoke('theia:update-settings', settings),
  onSnapshot: (callback) => {
    const listener = (_event, value) => callback(value)
    ipcRenderer.on('theia:snapshot', listener)
    return () => ipcRenderer.removeListener('theia:snapshot', listener)
  },
  onSyncProgress: (callback) => {
    const listener = (_event, value) => callback(value)
    ipcRenderer.on('theia:sync-progress', listener)
    return () => ipcRenderer.removeListener('theia:sync-progress', listener)
  },
  onAuthStatus: (callback) => {
    const listener = (_event, value) => callback(value)
    ipcRenderer.on('theia:auth-status', listener)
    return () => ipcRenderer.removeListener('theia:auth-status', listener)
  },
  onCourseSelection: (callback) => {
    const listener = (_event, value) => callback(value)
    ipcRenderer.on('theia:course-selection', listener)
    return () => ipcRenderer.removeListener('theia:course-selection', listener)
  },
  onNewMail: (callback) => {
    const listener = (_event, value) => callback(value)
    ipcRenderer.on('theia:new-mail', listener)
    return () => ipcRenderer.removeListener('theia:new-mail', listener)
  },
  windowMinimize: () => ipcRenderer.invoke('theia:window-minimize'),
  windowMaximize: () => ipcRenderer.invoke('theia:window-maximize'),
  windowClose: () => ipcRenderer.invoke('theia:window-close'),
  windowIsMaximized: () => ipcRenderer.invoke('theia:window-is-maximized'),
  // Appearance
  zoomGet: () => ipcRenderer.invoke('theia:zoom:get'),
  zoomSet: (percent) => ipcRenderer.send('theia:zoom:set-percent', percent),
  setAppearanceMode: (mode) => ipcRenderer.send('theia:appearance:mode', mode),
  chooseAppBackground: () => ipcRenderer.invoke('theia:select-app-background'),
  getAppearancePresets: () => ipcRenderer.invoke('theia:appearance-presets:get'),
  saveAppearancePresets: (presets) => ipcRenderer.invoke('theia:appearance-presets:save', presets),
  onAppearanceMode: (callback) => {
    const listener = (_event, value) => callback(value)
    ipcRenderer.on('theia:appearance:mode', listener)
    return () => ipcRenderer.removeListener('theia:appearance:mode', listener)
  },
}

contextBridge.exposeInMainWorld('theia', api)
// Existing renderer integrations may still reference window.theia during the brand migration.
contextBridge.exposeInMainWorld('buct', api)
