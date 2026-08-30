/**
 * Read the user's persisted campus building marks via the real renderer
 * localStorage (default session, same origin as the vite dev server).
 * This is the authoritative way to read marks; raw leveldb parsing cannot
 * decode compacted SSTable blocks.
 */
import { createRequire } from "node:module"
import { spawn } from "node:child_process"
import { resolve } from "node:path"

const require = createRequire(import.meta.url)
const electron = require("electron")

const app = `
const { app, BrowserWindow } = require('electron');
app.whenReady().then(async () => {
  try {
    const win = new BrowserWindow({
      width: 400, height: 300, show: false,
      webPreferences: { contextIsolation: true, nodeIntegration: false },
    });
    // Load the vite origin so localStorage shares the app's origin.
    const p = win.loadURL('http://127.0.0.1:5174/');
    const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('load timeout')), 8000));
    try { await Promise.race([p, timeout]); } catch (e) { /* page may error without bridge; storage is still readable */ }
    // Wait a beat for the origin to attach.
    await new Promise(r => setTimeout(r, 1500));
    const value = await win.webContents.executeJavaScript(
      "localStorage.getItem('theia-campus-building-marks-v1')"
    );
    console.log('MARKS_JSON ' + (value || 'null'));
  } catch (e) {
    console.log('ERROR ' + e.message);
  }
  app.exit(0);
});
`

import { mkdirSync, writeFileSync } from "node:fs"
const tmp = resolve(process.env.TEMP || ".", "theia-read-marks2")
mkdirSync(tmp, { recursive: true })
writeFileSync(resolve(tmp, "main.js"), app, "utf8")

const child = spawn(electron, [tmp], { stdio: "inherit" })
child.on("exit", () => process.exit(0))
