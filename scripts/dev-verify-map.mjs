/**
 * Headless interaction test for the campus map marking flow.
 * Loads the dev:web renderer in a hidden Electron window and simulates the
 * user actions: open CampusMapView, enter marking mode, click the map,
 * confirm a building, and verify the marker appears.
 *
 * Run: node scripts/dev-verify-map.mjs
 */
import { createRequire } from "node:module"
import { spawn } from "node:child_process"
import { resolve } from "node:path"

const require = createRequire(import.meta.url)
const electron = require("electron")

// The renderer needs the bridge to boot. In dev:web the DSH boot object is
// injected by the harness; for a bare verification we load the map component
// through vite and drive it with executeJavaScript on the real app DOM.
const app = `
const { app, BrowserWindow } = require('electron');
const url = 'http://127.0.0.1:5174/';
const win = new BrowserWindow({ width: 1400, height: 900, show: false, webPreferences: { contextIsolation: false, nodeIntegration: true } });
win.webContents.on('did-finish-load', async () => {
  try {
    const result = await win.webContents.executeJavaScript(\`
      (async () => {
        const out = {};
        // The app boots and shows the loading screen until the bridge resolves.
        // Find the sidebar item for the map and click it.
        const waitFor = (ms) => new Promise(r => setTimeout(r, ms));
        // The app may need a moment to paint the shell.
        for (let i = 0; i < 40; i++) {
          if (document.querySelector('.app-shell')) break;
          await waitFor(500);
        }
        out.shell = !!document.querySelector('.app-shell');
        // Sidebar contains buttons with text "校园地图"
        let mapButton = null;
        for (const el of document.querySelectorAll('button, [role=button]')) {
          if (el.textContent && el.textContent.includes('校园地图')) { mapButton = el; break; }
        }
        out.mapButtonFound = !!mapButton;
        if (mapButton) { mapButton.click(); }
        await waitFor(800);
        out.mapPanel = !!document.querySelector('.campus-map-panel');
        // Click the marking toggle button (aria-label 标注建筑位置)
        const markBtn = document.querySelector('[aria-label="标注建筑位置"]');
        out.markBtnFound = !!markBtn;
        if (markBtn) { markBtn.click(); }
        await waitFor(300);
        out.markingActive = !!document.querySelector('.map-stage.marking-active');
        // Click the center of the map sheet
        const sheet = document.querySelector('.map-sheet');
        if (sheet) {
          const r = sheet.getBoundingClientRect();
          const clickEvt = (el, x, y) => {
            el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: x, clientY: y, pointerId: 1 }));
            el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: x, clientY: y, pointerId: 1 }));
            el.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: x, clientY: y }));
          };
          clickEvt(sheet, r.left + r.width * 0.4, r.top + r.height * 0.45);
          await waitFor(300);
          out.candidateAfterClick = !!document.querySelector('.map-marker-overlay');
          out.selectorVisible = !!document.querySelector('.map-marker-selector');
        }
        // Pick the first building option
        const firstOption = document.querySelector('.map-marker-option');
        out.firstOption = firstOption ? firstOption.textContent : null;
        if (firstOption) { firstOption.click(); }
        await waitFor(300);
        out.markerAfterConfirm = !!document.querySelector('.map-building-marker');
        out.marks = [...document.querySelectorAll('.map-marker-item')].map(e => e.textContent).join(',');
        out.saved = localStorage.getItem('theia-campus-building-marks-v1');
        return out;
      })()
    \`);
    console.log('RESULT ' + JSON.stringify(result));
  } catch (e) {
    console.log('ERROR ' + e.message);
  }
  app.exit(0);
});
win.loadURL(url);
`

import { mkdirSync, writeFileSync } from "node:fs"
const tmp = resolve(process.env.TEMP || ".", "theia-map-verify")
mkdirSync(tmp, { recursive: true })
writeFileSync(resolve(tmp, "main.js"), app, "utf8")

const child = spawn(electron, [tmp], { stdio: "inherit" })
child.on("exit", () => process.exit(0))
