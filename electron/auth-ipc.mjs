export function registerAuthIpc({
  ipcMain,
  store,
  credentialVault,
  academicApiVault,
  mailVault,
  clearCredentialAttempts = () => {},
  authRecovery = {},
  getAuthEpoch = () => 0,
  assertAuthEpoch,
  waitForSchoolProxy = async () => {},
  getStatus,
  openLoginWindow,
} = {}) {
  ipcMain.handle('theia:get-auth-status', () => getStatus())
  ipcMain.handle('theia:get-credential-status', () => credentialVault.status())
  ipcMain.handle('theia:get-academic-api-credential-status', async () => ({
    ...(await academicApiVault.status()),
    enabled: store.snapshot().settings.academicApiEnabled,
  }))
  ipcMain.handle('theia:get-mail-credential-status', () => mailVault.status())
  ipcMain.handle('theia:read-saved-secret', async (_event, kind) => {
    if (kind === 'unified-password') return (await credentialVault.readCredentials())?.password || null
    if (kind === 'academic-api-password') return (await academicApiVault.readCredentials())?.password || null
    const credentials = await mailVault.readCredentials()
    if (kind === 'mail-password') return credentials?.password || null
    if (kind === 'mail-protocol-password') return credentials?.protocolPassword || null
    return null
  })
  ipcMain.handle('theia:save-credentials', (_event, credentials) => credentialVault.save(credentials || {}))
  ipcMain.handle('theia:save-academic-api-credentials', async (_event, credentials) => ({
    ...(await academicApiVault.save(credentials || {})),
    enabled: store.snapshot().settings.academicApiEnabled,
  }))
  ipcMain.handle('theia:clear-credentials', async () => {
    clearCredentialAttempts()
    return credentialVault.clear()
  })
  ipcMain.handle('theia:login', async () => {
    const epoch = getAuthEpoch()
    for (const recovery of Object.values(authRecovery)) {
      recovery.failures = 0
      recovery.lastAt = 0
      recovery.inFlight = false
    }
    await waitForSchoolProxy()
    assertAuthEpoch(epoch, { allowLoggedOut: true })
    return openLoginWindow({ expectedEpoch: epoch, userInitiated: true })
  })
  ipcMain.handle('theia:clear-academic-api-credentials', async () => ({
    ...(await academicApiVault.clear()),
    enabled: store.snapshot().settings.academicApiEnabled,
  }))
}
