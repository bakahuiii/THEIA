import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { AcademicApiClient } from '../core/academic-api-client.mjs'
import { JwglxtAdapter } from '../core/adapters/jwglxt.mjs'
import { JwglxtAttachmentStore } from '../core/jwglxt-attachment-store.mjs'

test('JWGLXT attachment store writes bounded PDF bytes and reuses the same file', async () => {
  const root = await mkdtemp(join(tmpdir(), 'theia-jwglxt-attachment-'))
  try {
    const store = new JwglxtAttachmentStore(root)
    const buffer = Buffer.from('%PDF-1.7\nlocal test')
    const first = await store.save({ id: 'plan-1', extension: 'pdf', buffer })
    assert.equal(first.cached, true)
    assert.equal(first.bytes, buffer.length)
    assert.match(first.sha256, /^[a-f0-9]{64}$/u)
    const found = await store.find('plan-1', 'pdf')
    assert.equal(found.bytes, buffer.length)
    assert.deepEqual(await readFile(found.path), buffer)
    const second = await store.save({ id: 'plan-1', extension: 'pdf', buffer })
    assert.equal(second.cached, true)
    assert.equal(second.filename, first.filename)
    await writeFile(found.path, '<html><form id="loginForm"></form></html>')
    assert.equal(await store.find('plan-1', 'pdf'), null)
    assert.throws(() => store.filePath('../outside', 'pdf'), /标识无效/u)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('exclusive cultivation-plan saves leave one local PDF', async () => {
  const root = await mkdtemp(join(tmpdir(), 'theia-jwglxt-plan-single-'))
  try {
    const store = new JwglxtAttachmentStore(root)
    await store.save({ id: 'former-major', extension: 'pdf', buffer: Buffer.from('%PDF-1.7\nformer') })
    await mkdir(store.directory, { recursive: true })
    const calendarPdf = join(store.directory, 'teaching_schedule_current.pdf')
    await writeFile(calendarPdf, '%PDF-1.7\ncalendar')
    const current = await store.save({ id: 'current-major', extension: 'pdf', buffer: Buffer.from('%PDF-1.7\ncurrent'), exclusive: true })
    assert.equal(store.directory, join(root, 'academic-calendar', 'assets'))
    assert.equal(await store.find('former-major', 'pdf'), null)
    assert.equal((await store.find('current-major', 'pdf')).filename, current.filename)
    assert.match((await readFile(calendarPdf)).toString('ascii'), /^%PDF-/u)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('cultivation-plan cache migrates the legacy file into the calendar PDF directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'theia-jwglxt-plan-migration-'))
  try {
    const store = new JwglxtAttachmentStore(root)
    await mkdir(store.legacyDirectory, { recursive: true })
    await writeFile(join(store.legacyDirectory, 'current-major.pdf'), '%PDF-1.7\nlegacy current')
    await store.keepOnly({ id: 'current-major', extension: 'pdf' })
    const migrated = await store.find('current-major', 'pdf')
    assert.equal(migrated.path, join(store.directory, 'current-major.pdf'))
    await assert.rejects(readFile(join(store.legacyDirectory, 'current-major.pdf')), /ENOENT/u)
    assert.equal(await store.find('former-major', 'pdf'), null)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('AcademicApiClient.binary preserves authenticated PDF bytes and headers', async () => {
  const pdf = Buffer.from('%PDF-1.7\napi test')
  const client = new AcademicApiClient({
    username: '2024000000',
    password: 'secret',
    fetchImpl: async () => new Response(pdf, {
      status: 200,
      headers: { 'content-type': 'application/pdf', 'content-length': String(pdf.length) },
    }),
  })
  const result = await client.binary('https://jwglxt.buct.edu.cn/jwglxt/plan.pdf')
  assert.deepEqual(result.buffer, pdf)
  assert.equal(result.headers.get('content-type'), 'application/pdf')
  assert.equal(result.text, '')
})

test('JwglxtAdapter does not redownload a cached cultivation-plan PDF', async () => {
  const previewUrl = 'https://jwglxt.buct.edu.cn/jwglxt/jxzxjhgl/jxzxjhxxwh_cxDyJxzxjhxx.html?jxzxjhxx_id=PLAN-1&gnmkdm=N153540'
  const calls = []
  const adapter = new JwglxtAdapter({
    async binary() {
      calls.push('binary')
      throw new Error('remote PDF should not be requested')
    },
    setDiagnostic() {},
  }, {
    attachmentStore: {
      async find() {
        return { bytes: 42, filename: 'cached.pdf' }
      },
      async save() {
        throw new Error('save should not be requested')
      },
    },
  })
  const result = await adapter.fetchExtraPayload({
    url: previewUrl,
    method: 'get',
    domain: 'academic-plan',
    routeCode: 'N153540',
    capturedAt: new Date().toISOString(),
    source: 'test',
  })
  assert.deepEqual(calls, [])
  assert.equal(result.attachments[0].cached, true)
  assert.equal(result.attachments[0].filename, 'cached.pdf')
})

test('JwglxtAdapter always stores cultivation-plan PDF bytes with the PDF extension', async () => {
  const saves = []
  const adapter = new JwglxtAdapter({
    async binary() {
      return {
        url: 'https://jwglxt.buct.edu.cn/jwglxt/download?id=PLAN-2',
        headers: new Headers({ 'content-type': 'application/pdf' }),
        buffer: Buffer.from('%PDF-1.7\nextensionless endpoint'),
      }
    },
    setDiagnostic() {},
  }, {
    attachmentStore: {
      async find() { return null },
      async save(value) {
        saves.push(value)
        return { cached: true, bytes: value.buffer.length, filename: 'cached.pdf', sha256: 'a'.repeat(64) }
      },
    },
  })
  const result = await adapter.fetchExtraPayload({
    url: 'https://jwglxt.buct.edu.cn/jwglxt/jxzxjhgl/jxzxjhxxwh_cxDyJxzxjhxx.html?jxzxjhxx_id=PLAN-2&gnmkdm=N153540',
    method: 'get',
    domain: 'academic-plan',
    routeCode: 'N153540',
    capturedAt: new Date().toISOString(),
    source: 'test',
  })
  assert.equal(saves.length, 1)
  assert.equal(saves[0].extension, 'pdf')
  assert.equal(result.attachments[0].cached, true)
})
