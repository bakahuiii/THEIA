import { spawn } from 'node:child_process'
import { access, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

const executable = resolve(process.argv[2] || 'release-bin/win-unpacked/THEIA.exe')
await access(executable).catch(() => {
  throw new Error(`Packaged executable does not exist: ${executable}`)
})
const smokeRoot = await mkdtemp(resolve(tmpdir(), 'theia-smoke-'))
const reportFile = resolve(smokeRoot, 'report.json')
const dataRoot = resolve(smokeRoot, 'data')

const child = spawn(executable, [], {
  env: {
    ...process.env,
    THEIA_SMOKE_FILE: reportFile,
    THEIA_DATA_ROOT: dataRoot,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
})

const outputChunks = []
const captureOutput = (stream, destination) => {
  stream.on('data', (chunk) => {
    outputChunks.push(Buffer.from(chunk))
    destination.write(chunk)
  })
}
captureOutput(child.stdout, process.stdout)
captureOutput(child.stderr, process.stderr)

const exitCode = await new Promise((resolveExit, reject) => {
  let settled = false
  const finish = (callback, value) => {
    if (settled) return
    settled = true
    clearTimeout(timeout)
    callback(value)
  }
  const timeout = setTimeout(() => {
    child.kill()
    finish(reject, new Error('Packaged smoke test timed out after 60 seconds'))
  }, 60_000)
  child.once('error', (error) => finish(reject, error))
  child.once('close', (code, signal) => finish(resolveExit, { code, signal }))
})

const report = JSON.parse(await readFile(reportFile, 'utf8'))
console.log(JSON.stringify(report, null, 2))
const runtimeFile = resolve(dataRoot, 'api-runtime.json')
const runtimeCleaned = await access(runtimeFile).then(() => false, () => true)
const processOutput = Buffer.concat(outputChunks).toString('utf8')
const runtimeError = /\[THEIA\] (?:uncaught exception|unhandled rejection|UnhandledPromiseRejectionWarning):/i.test(processOutput)
if (report.schema !== 'theia-packaged-smoke/v1' || exitCode.code !== 0 || exitCode.signal || !report.ok || report.stage !== 'renderer'
  || report.pdfBytes <= 1_000 || report.ocrRuntimeOk !== true || !runtimeCleaned || runtimeError) {
  throw new Error(`Packaged smoke test failed with exit code ${exitCode.code ?? 'unknown'}${exitCode.signal ? ` (${exitCode.signal})` : ''}`)
}

await rm(smokeRoot, { recursive: true, force: true })
