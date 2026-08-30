import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { writeAiExport } from '../core/ai-export.mjs'
import { collectionCsv, toIcs, toTheiaFeed } from '../core/schema.mjs'

export function registerDataExportIpc({
  ipcMain,
  dialog,
  shell,
  getMainWindow,
  getDocumentsDirectory,
  getDataRoot,
  store,
  getCourseSelection = () => null,
  getVersion,
  writeDiagnostic = () => {},
} = {}) {
  ipcMain.handle('theia:export-data', async (_event, { format = 'json', collection = 'grades' } = {}) => {
    const snapshot = store.snapshot()
    if (format === 'ai') {
      const chosen = await dialog.showOpenDialog(getMainWindow(), {
        title: '选择 AI 数据包导出位置',
        defaultPath: getDocumentsDirectory(),
        properties: ['openDirectory', 'createDirectory'],
      })
      if (chosen.canceled || !chosen.filePaths[0]) return { canceled: true }
      const result = await writeAiExport({
        destinationRoot: chosen.filePaths[0],
        state: snapshot,
        courseSelection: getCourseSelection(),
        appVersion: getVersion(),
      })
      void writeDiagnostic('data.ai_export_written', {
        files: result.files,
        exportedAt: result.manifest.exportedAt,
      })
      return { canceled: false, filePath: result.directory, files: result.files }
    }
    const content = format === 'theia'
      ? JSON.stringify(toTheiaFeed(snapshot), null, 2) + '\n'
      : format === 'ics'
        ? toIcs(snapshot)
        : format === 'csv'
          ? collectionCsv(snapshot, collection)
          : JSON.stringify(snapshot, null, 2) + '\n'
    const extension = format === 'ics' ? 'ics' : format === 'csv' ? 'csv' : 'json'
    const chosen = await dialog.showSaveDialog(getMainWindow(), {
      defaultPath: resolve(getDocumentsDirectory(), `theia-export.${extension}`),
      filters: [{ name: extension.toUpperCase(), extensions: [extension] }],
    })
    if (chosen.canceled || !chosen.filePath) return { canceled: true }
    await writeFile(chosen.filePath, content, 'utf8')
    return { canceled: false, filePath: chosen.filePath }
  })

  ipcMain.handle('theia:open-data-directory', async () => {
    const directory = getDataRoot()
    await mkdir(directory, { recursive: true })
    const outcome = await shell.openPath(directory)
    if (outcome) throw new Error(outcome)
    return { opened: true, path: directory }
  })

  ipcMain.handle('theia:open-schedule-directory', async () => {
    const directory = resolve(getDocumentsDirectory(), 'THEIA', '课表')
    await mkdir(directory, { recursive: true })
    const outcome = await shell.openPath(directory)
    if (outcome) throw new Error(outcome)
    return { opened: true, path: directory }
  })
}
