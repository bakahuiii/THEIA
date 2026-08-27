import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { TheolAttachmentStore } from '../core/theol-attachment-store.mjs'

test('THEOL attachment store saves, finds, and reuses a course resource', async () => {
  const root = await mkdtemp(join(tmpdir(), 'theia-theol-'))
  try {
    const store = new TheolAttachmentStore(root)
    const resource = {
      courseId: '101',
      id: 'resource-1',
      sourceKey: '101:file:resid=99',
      title: '教学大纲.pdf',
      fileName: '教学大纲.pdf',
      url: 'https://course.buct.edu.cn/meol/common/download.jsp?resid=99',
    }
    const bytes = Buffer.from('%PDF-test')
    const saved = await store.save(resource, bytes)
    assert.equal(saved.cached, true)
    assert.match(saved.filename, /-\w{12}\.pdf$/)
    assert.deepEqual(await readFile(saved.path), bytes)
    const found = await store.find(resource)
    assert.equal(found.bytes, bytes.length)
    assert.equal(found.path, saved.path)
    const second = await store.save(resource, bytes)
    assert.equal(second.path, saved.path)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('THEOL attachment store keeps resource keys isolated by course', async () => {
  const root = await mkdtemp(join(tmpdir(), 'theia-theol-'))
  try {
    const store = new TheolAttachmentStore(root)
    const base = { id: 'same', sourceKey: 'same', title: 'note.txt', url: 'https://course.buct.edu.cn/note.txt' }
    const first = await store.save({ ...base, courseId: '101' }, Buffer.from('one'))
    const second = await store.save({ ...base, courseId: '202' }, Buffer.from('two'))
    assert.notEqual(first.path, second.path)
    assert.equal((await store.find({ ...base, courseId: '101' })).bytes, 3)
    assert.equal((await store.find({ ...base, courseId: '202' })).bytes, 3)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

