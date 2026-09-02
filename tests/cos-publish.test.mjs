import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { buildCosAuthorization, COS_BUCKET, COS_REGION, cosHost, cosObjectUrl, loadCosConfig, normalizeCosConfig, publishCosArtifacts, saveCosConfig } from '../scripts/publish-cos.mjs'

test('COS publisher uses the configured bucket host and encoded object path', () => {
  assert.equal(cosHost(), 'theia-1314083262.cos.ap-beijing.myqcloud.com')
  assert.equal(
    cosObjectUrl('stable/THEIA 0.7.4/latest.yml'),
    'https://theia-1314083262.cos.ap-beijing.myqcloud.com/stable/THEIA%200.7.4/latest.yml',
  )
})

test('COS publisher rejects incomplete or malformed local credentials', () => {
  assert.throws(() => normalizeCosConfig({ secretId: 'id' }), /SecretId\/SecretKey/u)
  assert.throws(() => normalizeCosConfig({ secretId: 'id', secretKey: 'key', bucket: 'bad bucket' }), /Bucket/u)
  assert.deepEqual(
    normalizeCosConfig({ secretId: 'id', secretKey: 'key' }),
    { bucket: 'theia-1314083262', region: 'ap-beijing', secretId: 'id', secretKey: 'key' },
  )
})

test('COS publisher round-trips credentials through Windows user DPAPI', { skip: process.platform !== 'win32' }, async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'theia-cos-config-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  const configPath = join(root, 'cos-publish.json')
  const expected = { bucket: COS_BUCKET, region: COS_REGION, secretId: 'AKIDEXAMPLE', secretKey: 'secret-example' }

  await saveCosConfig({ ...expected, configPath })
  const raw = await readFile(configPath, 'utf8')
  assert.doesNotMatch(raw, /AKIDEXAMPLE|secret-example/u)
  assert.deepEqual(await loadCosConfig({ configPath }), expected)
})

test('COS publisher creates a deterministic signature without exposing the secret key', () => {
  const authorization = buildCosAuthorization({
    secretId: 'AKIDEXAMPLE',
    secretKey: 'secret-example',
    method: 'PUT',
    uriPath: '/stable/latest.yml',
    headers: { 'content-type': 'text/yaml' },
    nowSeconds: 1_700_000_000,
  })
  assert.match(authorization, /q-sign-algorithm=sha1/u)
  assert.match(authorization, /q-ak=AKIDEXAMPLE/u)
  assert.match(authorization, /q-sign-time=1700000000;1700000900/u)
  assert.match(authorization, /q-header-list=content-type/u)
  assert.doesNotMatch(authorization, /secret-example/u)
  assert.match(authorization, /q-signature=[0-9a-f]{40}/u)
})

test('COS publisher uploads the complete stable update set in order', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'theia-cos-publish-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  const releaseDirectory = join(root, 'release-bin')
  await mkdir(releaseDirectory, { recursive: true })
  const names = [
    'THEIA-0.7.4-x64-win.exe',
    'THEIA-0.7.4-x64-win.exe.blockmap',
    'latest.yml',
    'THEIA-0.7.4-source.zip',
  ]
  await writeFile(join(root, 'package.json'), JSON.stringify({ version: '0.7.4' }))
  for (const name of names) await writeFile(join(releaseDirectory, name), name)
  const requests = []
  const result = await publishCosArtifacts({
    projectRoot: root,
    config: { secretId: 'id', secretKey: 'secret-example' },
    fetchImpl: async (url, options) => {
      requests.push({ url, options })
      return { ok: true, status: 200 }
    },
    nowSeconds: 1_700_000_000,
  })
  assert.deepEqual(result.results.map((item) => item.key), names.map((name) => `stable/${name}`))
  assert.deepEqual(requests.map((request) => new URL(request.url).pathname), names.map((name) => `/stable/${name}`))
  assert.ok(requests.every((request) => request.options.method === 'PUT'))
  assert.ok(requests.every((request) => !String(request.options.headers.Authorization).includes('secret-example')))
})
