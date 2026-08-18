import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, symlink, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { createLocalDocumentsReader } from '../integration/local-docs.mjs'

async function tempRoot(t) {
  const root = await mkdtemp(join(tmpdir(), 'theia-local-docs-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  return root
}

test('local document reader lists and sanitizes HTML without exposing an absolute path', async (t) => {
  const root = await tempRoot(t)
  await writeFile(join(root, 'notice.html'), '<h1>校历</h1><script>alert(1)</script><a href="javascript:bad()">链接</a><p>内容</p>')
  await writeFile(join(root, 'guide.markdown'), '# 指南\n\n正文')
  const reader = createLocalDocumentsReader({ rootDir: root })
  const listed = await reader.list()
  assert.equal(listed.available, true)
  assert.equal(listed.documents.length, 2)
  assert.ok(listed.documents.every((item) => /^doc1:[a-f0-9]{32}$/u.test(item.documentId)))
  assert.doesNotMatch(JSON.stringify(listed), new RegExp(root.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'))
  const read = await reader.read({ documentId: listed.documents.find((item) => item.name === 'notice.html').documentId })
  assert.equal(read.trust, 'untrusted')
  assert.match(read.content, /校历/u)
  assert.match(read.content, /内容/u)
  assert.doesNotMatch(read.content, /script|javascript:|alert/u)
  const markdown = await reader.read({ documentId: listed.documents.find((item) => item.name === 'guide.markdown').documentId })
  assert.match(markdown.content, /指南/u)
})

test('local document reader rejects invalid opaque IDs and path traversal', async (t) => {
  const root = await tempRoot(t)
  await writeFile(join(root, 'plain.txt'), 'safe')
  const reader = createLocalDocumentsReader({ rootDir: root })
  await assert.rejects(reader.read({ documentId: '../plain.txt' }), /documentId is invalid/u)
  await assert.rejects(reader.read({ documentId: 'doc1:00000000000000000000000000000000' }), /not available/u)
})

test('local document reader skips symlinks and reports oversized files without reading them', async (t) => {
  const root = await tempRoot(t)
  const outside = await tempRoot(t)
  await writeFile(join(outside, 'outside.txt'), 'secret')
  let symlinkCreated = true
  try {
    await symlink(join(outside, 'outside.txt'), join(root, 'escape.txt'))
  } catch (error) {
    symlinkCreated = false
  }
  await writeFile(join(root, 'large.txt'), Buffer.alloc(32 * 1024 * 1024 + 1, 65))
  const reader = createLocalDocumentsReader({ rootDir: root })
  const listed = await reader.list()
  if (symlinkCreated) assert.equal(listed.documents.some((item) => item.name === 'escape.txt'), false)
  const large = listed.documents.find((item) => item.name === 'large.txt')
  assert.ok(large)
  const read = await reader.read({ documentId: large.documentId })
  assert.equal(read.content, null)
  assert.equal(read.error.code, 'too-large')
})
