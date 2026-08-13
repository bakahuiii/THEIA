import { spawn } from 'node:child_process'
import { access, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

const executable = resolve(process.argv[2] || 'release-bin/win-unpacked/THEIA.exe')
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
  const timeout = setTimeout(() => {
    child.kill()
    reject(new Error('Packaged smoke test timed out after 60 seconds'))
  }, 60_000)
  child.once('error', reject)
  child.once('close', (code) => {
    clearTimeout(timeout)
    resolveExit(code)
  })
})

const report = JSON.parse(await readFile(reportFile, 'utf8'))
console.log(JSON.stringify(report, null, 2))
const runtimeFile = resolve(dataRoot, 'api-runtime.json')
const runtimeCleaned = await access(runtimeFile).then(() => false, () => true)
const processOutput = Buffer.concat(outputChunks).toString('utf8')
const runtimeError = /\[THEIA\] (?:uncaught exception|unhandled rejection):/i.test(processOutput)
if (exitCode !== 0 || !report.ok || report.pdfBytes <= 1_000 || report.ocrRuntimeOk !== true || !runtimeCleaned || runtimeError) {
  throw new Error(`Packaged smoke test failed with exit code ${exitCode}`)
}

await rm(smokeRoot, { recursive: true, force: true })
