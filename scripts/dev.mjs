import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import process from 'node:process'
import { projectRoot, stopPreviousTheiaDevProcesses } from './dev-processes.mjs'

const require = createRequire(import.meta.url)
const electron = require('electron')
await stopPreviousTheiaDevProcesses()

const child = spawn(electron, ['electron/main.mjs'], {
  cwd: projectRoot,
  stdio: ['inherit', 'pipe', 'pipe'],
  windowsHide: false,
})

// Electron and native helpers can emit a BEL control character on Windows.
// Keep development diagnostics visible without turning each transient warning
// into a terminal notification sound.
const relay = (chunk) => process.stdout.write(String(chunk).replace(/\x07/g, ''))
child.stdout?.on('data', relay)
child.stderr?.on('data', relay)

for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal))
child.on('exit', (code) => { process.exitCode = code ?? 0 })
