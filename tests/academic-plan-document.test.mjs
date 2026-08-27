import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import {
  ACADEMIC_PLAN_DOCUMENT_SCHEMA,
  academicPlanDocumentMatches,
  buildAcademicPlanDocument,
  normalizeAcademicPlanDocument,
} from '../core/academic-plan-document.mjs'
import { startLocalApi } from '../core/local-api.mjs'

function authedFetch(api, url, init) {
  return fetch(url, { ...(init || {}), headers: { ...(init?.headers || {}), Authorization: `Bearer ${api.token}` } })
}
import { toTheiaFeed } from '../core/schema.mjs'
import { CampusStore } from '../core/store.mjs'

function digest(value) {
  return createHash('sha256').update(value).digest('hex')
}

async function planFixture() {
  const root = await mkdtemp(join(tmpdir(), 'theia-academic-plan-document-'))
  const path = join(root, 'current-plan.pdf')
  const buffer = Buffer.from('%PDF-1.7\nfixture')
  await writeFile(path, buffer)
  const attachment = {
    id: 'current-plan',
    type: 'pdf',
    bytes: buffer.length,
    sha256: digest(buffer),
    filename: 'current-plan.pdf',
  }
  const extractor = async () => ({
    total: 2,
    pages: [
      { num: 1, text: '2024高分子材料与工程执行计划\n计划学制 4 年 最低毕业学分 171' },
      { num: 2, text: '课程设置与学分分布\n专业必修 47.5 学分' },
    ],
  })
  return { root, path, buffer, attachment, extractor }
}

test('cultivation-plan PDF text is a validated page-level document', async () => {
  const fixture = await planFixture()
  try {
    const document = await buildAcademicPlanDocument({
      attachment: fixture.attachment,
      path: fixture.path,
      extractor: fixture.extractor,
      parsedAt: '2026-08-18T00:00:00.000Z',
    })
    assert.equal(document.schema, ACADEMIC_PLAN_DOCUMENT_SCHEMA)
    assert.equal(document.pageCount, 2)
    assert.equal(document.title, '2024高分子材料与工程执行计划')
    assert.equal(document.durationYears, 4)
    assert.equal(document.minimumGraduationCredits, 171)
    assert.equal(document.pages[1].number, 2)
    assert.equal(document.sourceSha256, fixture.attachment.sha256)
    assert.equal(academicPlanDocumentMatches(document, {
      attachmentId: fixture.attachment.id,
      sha256: fixture.attachment.sha256,
      bytes: fixture.attachment.bytes,
    }), true)
  } finally {
    await rm(fixture.root, { recursive: true, force: true })
  }
})

test('cultivation-plan document refuses a mismatched attachment or altered page text', async () => {
  const fixture = await planFixture()
  try {
    await assert.rejects(
      buildAcademicPlanDocument({
        attachment: { ...fixture.attachment, sha256: '0'.repeat(64) },
        path: fixture.path,
        extractor: fixture.extractor,
      }),
      /校验和/u,
    )
    const document = await buildAcademicPlanDocument({ attachment: fixture.attachment, path: fixture.path, extractor: fixture.extractor })
    assert.equal(normalizeAcademicPlanDocument({
      ...document,
      pages: [{ ...document.pages[0], text: '被篡改的培养计划页' }, document.pages[1]],
    }), null)
  } finally {
    await rm(fixture.root, { recursive: true, force: true })
  }
})

test('cultivation-plan JSON has its own fragment and never enters the public feed', async () => {
  const fixture = await planFixture()
  let api = null
  try {
    const document = await buildAcademicPlanDocument({ attachment: fixture.attachment, path: fixture.path, extractor: fixture.extractor })
    const storeRoot = join(fixture.root, 'store')
    const store = new CampusStore(storeRoot)
    await store.load()
    await store.update((state) => ({
      ...state,
      academicExtras: {
        ...state.academicExtras,
        domains: {
          'academic-plan': {
            label: '培养方案与教学执行计划', routeCodes: ['N153540'], sourceUrl: null, capturedAt: null,
            completeness: 'complete', queryStats: { attempted: 1, succeeded: 1, failed: 0, capped: false },
            messages: [], filters: [], attachments: [fixture.attachment], records: [],
          },
        },
      },
      academicPlanDocument: document,
    }))
    const manifest = JSON.parse(await readFile(resolve(storeRoot, 'data', 'manifest.json'), 'utf8'))
    assert.ok(manifest.fragments['academic/plan-document'])
    assert.ok(manifest.fragments['academic/extras'])
    const fragment = JSON.parse(await readFile(resolve(storeRoot, 'data', manifest.fragments['academic/plan-document'].path), 'utf8'))
    assert.equal(fragment.kind, 'academic/plan-document')
    assert.equal(fragment.value.pages[0].text.includes('最低毕业学分 171'), true)

    const reloaded = new CampusStore(storeRoot)
    const state = await reloaded.load()
    assert.equal(state.academicPlanDocument.pageCount, 2)
    const feed = JSON.stringify(toTheiaFeed(state))
    assert.equal(feed.includes('最低毕业学分 171'), false)
    assert.equal(feed.includes('academicPlanDocument'), false)

    api = await startLocalApi({ store: reloaded, root: storeRoot, preferredPort: 19745, publishRuntime: false })
    const response = await authedFetch(api, `${api.baseUrl}/v1/academic-plan-document`).then((value) => value.json())
    assert.equal(response.schema, 'theia-academic-plan-document-response/v1')
    assert.equal(response.item.pageCount, 2)
    assert.equal(response.item.pages[0].text.includes('最低毕业学分 171'), true)
  } finally {
    await api?.close()
    await rm(fixture.root, { recursive: true, force: true })
  }
})
