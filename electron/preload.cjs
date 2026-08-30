const { contextBridge, ipcRenderer } = require('electron')

const api = {
  getSnapshot: () => ipcRenderer.invoke('theia:get-snapshot'),
  getRendererSnapshot: () => ipcRenderer.invoke('theia:get-renderer-snapshot'),
  getUserDataOverview: () => ipcRenderer.invoke('theia:get-user-data-overview'),
  getUserDataDomainSummary: (domain) => ipcRenderer.invoke('theia:get-user-data-domain-summary', domain),
  getUserDataRecords: (domain, options) => ipcRenderer.invoke('theia:get-user-data-records', domain, options),
  getAdvisorOverview: () => ipcRenderer.invoke('theia:advisor:get-overview'),
  getAdvisorAcademicWhatIf: (scenario) => ipcRenderer.invoke('theia:advisor:academic-what-if', scenario),
  getAdvisorCourseDecisions: (request) => ipcRenderer.invoke('theia:advisor:course-decisions', request),
  executeAdvisorAction: (request) => ipcRenderer.invoke('theia:advisor:execute-action', request),
  listAdvisorThreads: () => ipcRenderer.invoke('theia:advisor:list-threads'),
  createAdvisorThread: () => ipcRenderer.invoke('theia:advisor:create-thread'),
  prepareAdvisorRequest: (request) => ipcRenderer.invoke('theia:advisor:prepare', request),
  sendAdvisorRequest: (request) => ipcRenderer.invoke('theia:advisor:send', request),
  cancelAdvisorRequest: (request) => ipcRenderer.invoke('theia:advisor:cancel', request),
  deleteAdvisorThread: (threadId) => ipcRenderer.invoke('theia:advisor:delete-thread', threadId),
  onAdvisorStream: (callback) => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('theia:advisor:stream', listener)
    return () => ipcRenderer.removeListener('theia:advisor:stream', listener)
  },
  getActivityLog: () => ipcRenderer.invoke('theia:get-activity-log'),
  getIrisStatus: () => ipcRenderer.invoke('theia:get-iris-status'),
  getUpdateStatus: () => ipcRenderer.invoke('theia:get-update-status'),
  openIrisControlPanel: () => ipcRenderer.invoke('theia:open-iris-control-panel'),
  saveIrisSettings: (settings) => ipcRenderer.invoke('theia:save-iris-settings', settings),
  saveIrisCredentials: (credentials) => ipcRenderer.invoke('theia:save-iris-credentials', credentials),
  clearIrisCredentials: () => ipcRenderer.invoke('theia:clear-iris-credentials'),
  startIris: () => ipcRenderer.invoke('theia:start-iris'),
  stopIris: () => ipcRenderer.invoke('theia:stop-iris'),
  restartIris: () => ipcRenderer.invoke('theia:restart-iris'),
  checkForUpdates: () => ipcRenderer.invoke('theia:check-for-updates'),
  installUpdate: () => ipcRenderer.invoke('theia:install-update'),
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
  queryFreeClassrooms: (query) => ipcRenderer.invoke('theia:query-free-classrooms', query),
  getCourseSelection: () => ipcRenderer.invoke('theia:get-course-selection'),
  discoverCourseSelection: () => ipcRenderer.invoke('theia:discover-course-selection'),
  getCourseSelectionCandidates: (blockId, target, options) => ipcRenderer.invoke('theia:get-course-selection-candidates', blockId, target, options),
  searchSchoolSchedule: (query) => ipcRenderer.invoke('theia:search-school-schedule', query),
  getCachedSchoolSchedule: (scope) => ipcRenderer.invoke('theia:get-cached-school-schedule', scope),
  getMotionVenueCatalog: () => ipcRenderer.invoke('theia:get-motion-venue-catalog'),
  refreshMotionVenueCatalog: () => ipcRenderer.invoke('theia:refresh-motion-venue-catalog'),
  queryMotionVenueStatus: (query) => ipcRenderer.invoke('theia:query-motion-venue-status', query),
  saveCourseSelectionTarget: (target) => ipcRenderer.invoke('theia:save-course-selection-target', target),
  removeCourseSelectionTarget: (id) => ipcRenderer.invoke('theia:remove-course-selection-target', id),
  setCourseSelectionSentinel: (config) => ipcRenderer.invoke('theia:set-course-selection-sentinel', config),
  startCourseSelection: (options) => ipcRenderer.invoke('theia:start-course-selection', options),
  stopCourseSelection: () => ipcRenderer.invoke('theia:stop-course-selection'),
  getAcademicCalendarAssets: () => ipcRenderer.invoke('theia:get-academic-calendar-assets'),
  refreshAcademicCalendarAssets: (options) => ipcRenderer.invoke('theia:refresh-academic-calendar-assets', options),
  openSource: (url) => ipcRenderer.invoke('theia:open-source', url),
  refreshCourseResources: (courseId) => ipcRenderer.invoke('theia:refresh-course-resources', courseId),
  downloadCourseResource: (courseId, resourceId) => ipcRenderer.invoke('theia:download-course-resource', courseId, resourceId),
  openAcademicAttachment: (domain, attachmentId) => ipcRenderer.invoke('theia:open-academic-attachment', domain, attachmentId),
  openAssignmentSource: (assignmentId) => ipcRenderer.invoke('theia:open-assignment-source', assignmentId),
  getFitnessScore: (year, options) => ipcRenderer.invoke('theia:get-fitness-score', year, options),
  openSchedulePdf: () => ipcRenderer.invoke('theia:open-schedule-pdf'),
  getCourseWorkQueue: () => ipcRenderer.invoke('theia:get-course-work-queue'),
  setCourseWorkQueueEnabled: (enabled) => ipcRenderer.invoke('theia:set-course-work-queue-enabled', enabled),
  enqueueCourseWork: (request) => ipcRenderer.invoke('theia:enqueue-course-work', request),
  cancelCourseWorkJob: (jobId) => ipcRenderer.invoke('theia:cancel-course-work-job', jobId),
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
  installMcpClients: () => ipcRenderer.invoke('theia:install-mcp-clients'),
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
  onUpdateStatus: (callback) => {
    const listener = (_event, value) => callback(value)
    ipcRenderer.on('theia:update-status', listener)
    return () => ipcRenderer.removeListener('theia:update-status', listener)
  },
  onCourseSelection: (callback) => {
    const listener = (_event, value) => callback(value)
    ipcRenderer.on('theia:course-selection', listener)
    return () => ipcRenderer.removeListener('theia:course-selection', listener)
  },
  onCourseWorkQueue: (callback) => {
    const listener = (_event, value) => callback(value)
    ipcRenderer.on('theia:course-work-queue', listener)
    return () => ipcRenderer.removeListener('theia:course-work-queue', listener)
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
