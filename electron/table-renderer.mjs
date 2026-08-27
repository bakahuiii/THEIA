/**
 * Renders an HTML table (or any HTML) to a PNG image buffer.
 * Uses a hidden Electron BrowserWindow + webContents.capturePage().
 * No external binaries required — the embedded Chromium does the work.
 *
 * Usage (from main.mjs or ipcMain):
 *   import { renderHtmlToPng } from './table-renderer.mjs'
 *   const pngBuffer = await renderHtmlToPng('<table>...</table>', { width: 800, height: 600 })
 */

import { BrowserWindow } from 'electron'

const DEFAULT_WIDTH = 900
const DEFAULT_HEIGHT = 600
const RENDER_TIMEOUT = 15_000

const TABLE_CSS = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Segoe UI', 'Noto Sans SC', -apple-system, sans-serif;
    font-size: 13px;
    color: #1a1a1a;
    padding: 20px;
    background: #fff;
  }
  table {
    border-collapse: collapse;
    width: 100%;
    font-size: 12px;
  }
  th, td {
    border: 1px solid #d0d0d0;
    padding: 7px 10px;
    text-align: left;
    white-space: nowrap;
  }
  th {
    background: #f0f2f5;
    font-weight: 600;
    position: sticky;
    top: 0;
  }
  tr:nth-child(even) { background: #fafafa; }
  tr:hover { background: #eef5ff; }
  .title {
    font-size: 16px;
    font-weight: 600;
    margin-bottom: 12px;
    color: #333;
  }
  .subtitle {
    font-size: 11px;
    color: #888;
    margin-bottom: 16px;
  }
  .count {
    font-size: 11px;
    color: #666;
    margin-top: 10px;
    text-align: right;
  }
  .motion-section { margin-bottom: 18px; }
  .motion-caption {
    font-size: 13px;
    font-weight: 600;
    color: #333;
    margin: 14px 0 8px;
  }
  .motion { margin-top: 0; }
  .motion th {
    background: #f0f2f5;
    font-weight: 600;
    text-align: center;
    white-space: nowrap;
  }
  .motion td { text-align: center; padding: 4px 6px; }
  .motion .cell { display: inline-flex; flex-direction: column; gap: 2px; min-width: 64px; }
  .motion .cell b { font-size: 10px; color: #444; font-weight: 600; }
  .motion .cell small { font-size: 10px; }
  .motion .cell.available small { color: #15803d; }
  .motion .cell.occupied small { color: #b45309; }
  .motion .cell.closed small { color: #9ca3af; }
  .motion .cell.unknown small { color: #6b7280; }
  .motion .cell.available { background: #ecfdf5; border-radius: 4px; }
  .motion .cell.occupied { background: #fffbeb; border-radius: 4px; }
  .motion .cell.closed { background: #f9fafb; border-radius: 4px; }
  .room-section { margin-bottom: 16px; }
  .room-caption {
    font-size: 13px;
    font-weight: 600;
    color: #333;
    margin-bottom: 8px;
  }
  .room-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .room-card {
    display: inline-flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    min-width: 74px;
    padding: 7px 10px;
    border: 1px solid #e5e7eb;
    border-radius: 6px;
    background: #fafafa;
    white-space: nowrap;
  }
  .room-card b { color: #1a1a1a; font-size: 12px; font-weight: 600; }
  .room-card small { color: #9ca3af; font-size: 10px; }
`

/**
 * Render an HTML string to a PNG image buffer.
 *
 * @param {string} html - Complete HTML document (or fragment auto-wrapped).
 * @param {{ width?: number, height?: number, fullPage?: boolean, timeoutMs?: number }} options
 * @returns {Promise<Buffer>} PNG image buffer.
 */
export async function renderHtmlToPng(html, {
  width = DEFAULT_WIDTH,
  height = DEFAULT_HEIGHT,
  fullPage = true,
  timeoutMs = RENDER_TIMEOUT,
} = {}) {
  // Wrap bare fragments into a complete document.
  const fullHtml = /<html[\s>]/iu.test(html)
    ? html
    : `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><style>${TABLE_CSS}</style></head><body>${html}</body></html>`

  // Chromium data URL length limit is ~2 MB.
  const encoded = encodeURIComponent(fullHtml)
  if (encoded.length > 1_800_000) {
    throw new Error(`渲染内容过长（${encoded.length} 字节编码后），请减少数据量后重试。`)
  }

  const win = new BrowserWindow({
    show: false,
    width,
    height,
    webPreferences: { nodeIntegration: false, sandbox: true, contextIsolation: true },
  })

  try {
    const loadResult = win.loadURL(`data:text/html;charset=utf-8,${encoded}`)
    await Promise.race([
      loadResult,
      new Promise((_, reject) => setTimeout(() => reject(new Error('表格渲染页面加载超时')), timeoutMs)),
    ]).catch((error) => {
      // If loadURL timed out, destroy the window and re-throw.
      if (!win.isDestroyed()) win.destroy()
      throw error
    })

    if (fullPage) {
      // Adjust window to content size so the full table is captured without
      // clipping the right edge or the bottom rows.
      let { width: contentWidth, height: contentHeight } = await win.webContents.executeJavaScript(
        '({ width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight })',
      )
      contentWidth = Math.max(contentWidth, width)
      contentHeight = Math.max(contentHeight, height)
      const clampedWidth = Math.min(contentWidth, 1_600)
      const clampedHeight = Math.min(contentHeight, 10_000)
      win.setContentSize(clampedWidth, clampedHeight)
      // Wait for the resize to take effect before capturing; poll the content
      // size until it matches the target (or a reasonable timeout).
      const resizeStartedAt = Date.now()
      while (Date.now() - resizeStartedAt < 2_000) {
        const current = await win.webContents.executeJavaScript(
          '({ w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight })',
        )
        if (current.w >= clampedWidth && current.h >= clampedHeight) break
        await new Promise((resolve) => setTimeout(resolve, 30))
      }
    }

    const image = await win.webContents.capturePage()
    return image.toPNG()
  } finally {
    if (!win.isDestroyed()) win.destroy()
  }
}