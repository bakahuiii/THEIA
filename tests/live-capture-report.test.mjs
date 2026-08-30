import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { compareLiveCaptureResults, createLiveCaptureAttachmentStore, liveCaptureResultCounts, writeLiveCaptureJson } from '../electron/live-capture-report.mjs'

test('live capture report compares domain payloads without exposing raw attachments', () => {
  const result = liveCaptureResultCounts({
    profile: { name: 'Student' },
    courses: [{ id: 'course-1' }],
    academicExtras: { domains: { 'academic-plan': { records: [{ id: 'plan' }], attachments: [{ id: 'pdf' }] } } },
    domainOutcomes: { profile: { succeeded: true } },
    errors: [],
  })
  assert.equal(result.profileFields, 1)
  assert.equal(result.courses, 1)
  assert.equal(result.academicExtras['academic-plan'].attachments, 1)

  const comparison = compareLiveCaptureResults(
    { result: { profile: { name: 'Student' }, domainOutcomes: { profile: { succeeded: true } }, errors: [] } },
    { result: { profile: { name: 'Different' }, domainOutcomes: { profile: { succeeded: false } }, errors: [{}] } },
  )
  assert.equal(comparison.schema, 'theia-live-capture-comparison/v2')
  assert.equal(comparison.domains.profile.differences.digestEqual, false)
  assert.equal(comparison.totals.browserSucceeded, 1)
  assert.equal(comparison.totals.apiErrors, 1)
})

test('live capture report writes bounded attachment fixtures and JSON records', async () => {
  const root = await mkdtemp(join(tmpdir(), 'theia-live-report-'))
  try {
    const attachments = createLiveCaptureAttachmentStore(root, 'browser')
    const saved = await attachments.save({ id: 'course/plan', extension: 'pdf', buffer: Buffer.from('%PDF-fixture') })
    assert.equal(saved.bytes, Buffer.byteLength('%PDF-fixture'))
    assert.equal(saved.filename, 'course_plan.pdf')
    assert.equal((await readFile(saved.path, 'utf8')).startsWith('%PDF-'), true)
    await writeLiveCaptureJson(root, 'meta.json', { schema: 'test/v1' })
    assert.match(await readFile(join(root, 'meta.json'), 'utf8'), /test\/v1/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
