import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { access, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { CampusStore } from '../core/store.mjs'

const CLI = resolve('cli', 'theia-cli.mjs')

function runCli(args, { dataRoot, appData }) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      cwd: resolve('.'),
      env: { ...process.env, THEIA_DATA_ROOT: dataRoot, APPDATA: appData },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.once('error', reject)
    child.once('close', (code, signal) => resolveRun({ code, signal, stdout, stderr }))
  })
}

function digest(value) {
  return createHash('sha256').update(value).digest('hex')
}

test('CLI help exits before initializing a fresh data root', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'theia-cli-help-'))
  const helpInvocations = [[], ['help'], ['--help'], ['status', '--help']]
  try {
    for (const [index, args] of helpInvocations.entries()) {
      const dataRoot = resolve(root, `data-${index}`)
      const appData = resolve(root, `appdata-${index}`)
      const result = await runCli(args, { dataRoot, appData })

      assert.equal(result.code, 0, result.stderr)
      assert.equal(result.signal, null)
      assert.equal(result.stderr, '')
      assert.match(result.stdout, /theia status/)
      await assert.rejects(access(dataRoot), { code: 'ENOENT' })
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('CLI uses the isolated data root and redacts diagnostic credentials', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'theia-cli-'))
  const dataRoot = resolve(root, 'isolated-data')
  const appData = resolve(root, 'fake-appdata')
  const appDataRoot = resolve(appData, 'THEIA')
  const jsonFile = resolve(root, 'snapshot.json')
  const aiParent = resolve(root, 'ai-exports')
  const isolatedMarker = 'ISOLATED-DATA-9d41'
  const appDataMarker = 'APPDATA-BAIT-a812'
  const secret = 'CLI-SECRET-f73c'
  const privatePath = 'C:\\Users\\Audit\\private.txt'
  try {
    const isolated = new CampusStore(dataRoot)
    await isolated.load()
    await isolated.update((state) => ({
      ...state,
      profile: { name: isolatedMarker },
      courses: [{ id: 'isolated-course', title: isolatedMarker, source: 'jwglxt' }],
      sync: {
        ...state.sync,
        lastCompletedAt: '2026-08-12T00:00:00.000Z',
        sources: { jwglxt: { connected: true, checkedAt: '2026-08-12T00:00:00.000Z' } },
      },
    }))

    const bait = new CampusStore(appDataRoot)
    await bait.load()
    await bait.update((state) => ({
      ...state,
      profile: { name: appDataMarker },
      courses: [{ id: 'appdata-course', title: appDataMarker, source: 'jwglxt' }],
    }))

    const jsonRun = await runCli(['export', '--format', 'json', '--output', jsonFile], { dataRoot, appData })
    assert.equal(jsonRun.code, 0, jsonRun.stderr)
    const snapshotText = await readFile(jsonFile, 'utf8')
    const snapshot = JSON.parse(snapshotText)
    assert.equal(snapshot.schema, 'theia-campus-data/v1')
    assert.equal(snapshot.profile.name, isolatedMarker)
    assert.equal(snapshotText.includes(appDataMarker), false)

    await isolated.update((state) => ({
      ...state,
      sync: {
        ...state.sync,
        sources: {
          jwglxt: {
            connected: false,
            url: `https://jwglxt.buct.edu.cn/status?token=${secret}#session`,
            error: `request https://jwglxt.buct.edu.cn/status?token=${secret}#session failed; Authorization: Bearer ${secret}; file ${privatePath}`,
            cookie: secret,
            nested: { apiKey: secret, authorization: `Basic ${Buffer.from(secret).toString('base64')}` },
          },
        },
      },
    }))

    const statusRun = await runCli(['status', '--json'], { dataRoot, appData })
    assert.equal(statusRun.code, 0, statusRun.stderr)
    const status = JSON.parse(statusRun.stdout)
    assert.equal(status.dataRoot, dataRoot)
    assert.equal(status.counts.courses, 1)
    assert.equal(status.sources.jwglxt.url, 'https://jwglxt.buct.edu.cn/status')
    assert.equal('cookie' in status.sources.jwglxt, false)
    assert.equal('apiKey' in status.sources.jwglxt.nested, false)
    assert.equal('authorization' in status.sources.jwglxt.nested, false)
    assert.equal(statusRun.stdout.includes(secret), false)
    assert.equal(statusRun.stdout.includes(privatePath), false)
    assert.equal(statusRun.stdout.includes(appDataMarker), false)

    const doctorRun = await runCli(['doctor'], { dataRoot, appData })
    assert.equal(doctorRun.code, 1, doctorRun.stderr)
    const doctor = JSON.parse(doctorRun.stdout)
    assert.equal(doctor.dataRoot, dataRoot)
    assert.equal(doctor.problems.length, 1)
    assert.equal(doctorRun.stdout.includes(secret), false)
    assert.equal(doctorRun.stdout.includes(privatePath), false)
    assert.equal(doctorRun.stdout.includes('?token='), false)
    assert.match(doctor.problems[0], /authorization=\[redacted\]/i)
    assert.match(doctor.problems[0], /\[local-path\]/)

    const aiRun = await runCli(['export', '--format', 'ai', '--output', aiParent], { dataRoot, appData })
    assert.equal(aiRun.code, 0, aiRun.stderr)
    const aiResult = JSON.parse(aiRun.stdout)
    assert.equal(aiResult.ok, true)
    assert.equal(aiResult.schema, 'theia-ai-context/v1')
    const manifestText = await readFile(resolve(aiResult.directory, 'manifest.json'), 'utf8')
    const manifest = JSON.parse(manifestText)
    assert.equal(manifest.schema, 'theia-ai-export-manifest/v1')
    for (const file of manifest.files) {
      const content = await readFile(resolve(aiResult.directory, file.path), 'utf8')
      assert.equal(Buffer.byteLength(content), file.bytes, file.path)
      assert.equal(digest(content), file.sha256, file.path)
      assert.equal(content.includes(secret), false, file.path)
      assert.equal(content.includes(privatePath), false, file.path)
      assert.equal(content.includes(appDataMarker), false, file.path)
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
