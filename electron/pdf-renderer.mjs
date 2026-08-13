/**
 * Renders a Markdown string to PDF using the Electron-embedded Chromium.
 * No external binaries (Chrome, typst, pandoc) required.
 *
 * Usage (from ipcMain):
 *   import { renderMarkdownToPdf } from './pdf-renderer.mjs'
 *   const pdfBuffer = await renderMarkdownToPdf(markdownText, { title: '答案' })
 */

import { BrowserWindow } from 'electron'
import { markdownDocument } from '../core/markdown-html.mjs'

const DEFAULT_CSS = `
  body {
    font-family: 'Segoe UI', 'Noto Sans SC', sans-serif;
    font-size: 13px;
    line-height: 1.7;
    max-width: 800px;
    margin: 0 auto;
    padding: 32px 40px;
    color: #1a1a1a;
  }
  h1, h2, h3, h4 { font-weight: 600; margin-top: 1.4em; }
  h1 { font-size: 1.7em; border-bottom: 1px solid #ddd; padding-bottom: 6px; }
  h2 { font-size: 1.3em; }
  code {
    background: #f4f4f4;
    border-radius: 3px;
    padding: 1px 4px;
    font-family: 'Cascadia Code', Consolas, monospace;
    font-size: 0.9em;
  }
  pre > code { display: block; padding: 12px; overflow-x: auto; }
  blockquote { border-left: 3px solid #ccc; margin: 0; padding-left: 16px; color: #555; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #ddd; padding: 6px 10px; text-align: left; }
  th { background: #f7f7f7; }
  img { max-width: 100%; }
  @media print {
    body { max-width: none; padding: 16px 20px; }
  }
`

/**
 * Convert Markdown text to PDF buffer.
 * Uses a hidden BrowserWindow + Electron's webContents.printToPDF().
 *
 * @param {string} markdown - Raw markdown source.
 * @param {{ title?: string, landscape?: boolean, timeoutMs?: number }} options
 * @returns {Promise<Buffer>} PDF binary buffer.
 */
export async function renderMarkdownToPdf(markdown, {
  title = '文档',
  landscape = false,
  timeoutMs = 30_000,
} = {}) {
  const fullHtml = await markdownDocument(markdown, { title, css: DEFAULT_CSS })

  const win = new BrowserWindow({
    show: false,
    width: 1,
    height: 1,
    webPreferences: { nodeIntegration: false, sandbox: true, contextIsolation: true },
  })

  try {
    await Promise.race([
      win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(fullHtml)}`),
      new Promise((_, reject) => setTimeout(() => reject(new Error('PDF 渲染页面加载超时')), timeoutMs)),
    ])
    const pdfData = await win.webContents.printToPDF({
      printBackground: true,
      landscape,
      pageSize: 'A4',
      margins: { marginType: 'custom', top: 0.5, bottom: 0.5, left: 0.6, right: 0.6 },
    })
    return Buffer.from(pdfData)
  } finally {
    if (!win.isDestroyed()) win.destroy()
  }
}
