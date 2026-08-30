export function registerIrisIpc({
  ipcMain,
  irisCompanion,
  recentActivityLog,
  openIrisControlPanel,
} = {}) {
  ipcMain.handle('theia:get-activity-log', () => recentActivityLog())
  ipcMain.handle('theia:get-iris-status', () => irisCompanion.status())
  ipcMain.handle('theia:open-iris-control-panel', () => openIrisControlPanel())
  ipcMain.handle('theia:save-iris-settings', async (_event, settings) => {
    const saved = await irisCompanion.writeSettings(settings)
    if (saved.enabled) await irisCompanion.start()
    else await irisCompanion.stop({ disable: true })
    return irisCompanion.status()
  })
  ipcMain.handle('theia:save-iris-credentials', async (_event, credentials) => irisCompanion.saveCredentials(credentials))
  ipcMain.handle('theia:clear-iris-credentials', async () => {
    await irisCompanion.stop({ disable: true })
    return irisCompanion.clearCredentials()
  })
  ipcMain.handle('theia:start-iris', () => irisCompanion.start({ force: true }))
  ipcMain.handle('theia:stop-iris', () => irisCompanion.stop({ disable: true }))
  ipcMain.handle('theia:restart-iris', () => irisCompanion.restart())
}
