import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import JSZip from 'jszip'
import { collectSourceFiles, isForbiddenSourcePath, verifySourceArchive } from '../scripts/package-source.mjs'
import { stripJpegMetadata } from '../scripts/strip-jpeg-metadata.mjs'

test('Windows packaging writes THEIA executable metadata and unpacks the offline OCR runtime', async () => {
  const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(packageJson.version, '0.4.1')
  assert.equal(packageJson.build.productName, 'THEIA')
  assert.equal(packageJson.build.appId, 'io.github.bakahuiii.theia')
  assert.equal(packageJson.build.nsis.guid, '2467e4eb-7496-532c-ab2c-b64234a36eb3')
  assert.equal(packageJson.build.win.signAndEditExecutable, true)
  assert.equal(packageJson.build.win.forceCodeSigning, false)
  for (const pattern of [
    'node_modules/tesseract.js/**/*',
    'node_modules/tesseract.js-core/**/*',
    'node_modules/@tesseract.js-data/chi_sim/**/*',
    'node_modules/bmp-js/**/*',
    'node_modules/is-url/**/*',
    'node_modules/regenerator-runtime/**/*',
    'node_modules/wasm-feature-detect/**/*',
  ]) assert.ok(packageJson.build.asarUnpack.includes(pattern), pattern)
})

test('packaging excludes credential extractors and accidental runtime data from application directories', async () => {
  const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  for (const pattern of [
    '!electron/extract-*-cookies.py',
    '!{dist,electron,core,cli,integration}/**/*.{log,sqlite,sqlite3,db,db-wal,db-shm,tmp,pyc}',
    '!{dist,electron,core,cli,integration}/**/{__pycache__,.cache,cache,caches,logs,.references}{,/**/*}',
    '!{dist,electron,core,cli,integration}/**/{auth-diagnostics.ndjson,api-runtime.json,buct-data.json,model-config-transaction.v1.json,theia-feed.json}',
    '!{dist,electron,core,cli,integration}/**/*.dpapi.json',
  ]) assert.ok(packageJson.build.files.includes(pattern), pattern)
  assert.equal(packageJson.build.files.some((pattern) => pattern === '**/*' || pattern === './**/*'), false)
})

test('release packaging also creates a filtered, buildable source archive', async () => {
  const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(packageJson.scripts['dist:source'], 'node scripts/package-source.mjs')
  assert.match(packageJson.scripts['dist:installer'], /&& npm run dist:source$/)

  const paths = (await collectSourceFiles()).map((entry) => entry.path)
  for (const required of [
    'package.json',
    'package-lock.json',
    'build/theia-icon.ico',
    'electron/main.mjs',
    'scripts/package-source.mjs',
    'scripts/strip-jpeg-metadata.mjs',
    'src/App.tsx',
    'tests/packaging-config.test.mjs',
  ]) assert.ok(paths.includes(required), required)

  for (const forbidden of [
    'electron/extract-chrome-cookies.py',
    'electron/extract-wxwork-cookies.py',
    'electron/model-config-transaction.v1.json',
    'scripts/__pycache__/crawl-jwglxt-api.cpython-313.pyc',
    'scripts/extract_manual.py',
    'scripts/extract_pdf.py',
    'scripts/read_pdf.mjs',
    'scripts/crawl-jwglxt-api.py',
    'src/assets/DSC_8146-已增强-降噪.jpg',
    'src/styles.css.bak',
  ]) {
    assert.equal(isForbiddenSourcePath(forbidden), true, forbidden)
    assert.equal(paths.includes(forbidden), false, forbidden)
  }
  assert.equal(paths.some(isForbiddenSourcePath), false)
})

test('source archive verification rejects implicit directories and rewritten paths', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'theia-source-archive-'))
  context.after(() => rm(directory, { recursive: true, force: true }))

  async function writeArchive(name, sourcePath, { createFolders = false } = {}) {
    const rootName = 'THEIA-0.4.0-source'
    const content = Buffer.from('{"name":"fixture"}\n')
    const path = sourcePath || 'package.json'
    const manifest = {
      schema: 'theia-source-package/v1',
      name: 'theia-campus-client',
      version: '0.4.0',
      rootDirectory: rootName,
      fileCount: 1,
      totalBytes: content.length,
      files: [{
        path,
        bytes: content.length,
        sha256: createHash('sha256').update(content).digest('hex').toUpperCase(),
      }],
    }
    const zip = new JSZip()
    zip.file(`${rootName}/${path}`, content, { createFolders })
    zip.file(`${rootName}/SOURCE-MANIFEST.json`, `${JSON.stringify(manifest)}\n`, { createFolders: false })
    const output = join(directory, name)
    await writeFile(output, await zip.generateAsync({ type: 'nodebuffer' }))
    return output
  }

  const valid = await writeArchive('valid.zip', 'package.json')
  assert.equal((await verifySourceArchive(valid)).sourceFiles, 1)

  const directories = await writeArchive('directories.zip', 'src/index.js', { createFolders: true })
  await assert.rejects(verifySourceArchive(directories), /must not contain directory entries/)

  const rewritten = await writeArchive('rewritten.zip', '../outside.json')
  await assert.rejects(verifySourceArchive(rewritten), /unsafe entry path/)
})

test('Windows runtime app id matches the packaged application id', async () => {
  const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  const mainSource = await readFile(new URL('../electron/main.mjs', import.meta.url), 'utf8')
  assert.match(mainSource, new RegExp(`app\\.setAppUserModelId\\(['\"]${packageJson.build.appId}['\"]\\)`))
})

test('packaged smoke mode is offline and exercises the advisor overview bridge', async () => {
  const mainSource = await readFile(new URL('../electron/main.mjs', import.meta.url), 'utf8')
  const smokeSource = await readFile(new URL('../scripts/smoke-packaged.mjs', import.meta.url), 'utf8')
  assert.match(mainSource, /if \(smokeFile\) \{[\s\S]*?offlineSmoke: true[\s\S]*?const \[verifiedJwglxt/)
  assert.match(mainSource, /if \(!smokeFile\) \{[\s\S]*?refreshAcademicCalendarAssets\(\{ trigger: 'startup' \}\)/)
  assert.match(mainSource, /if \(!smokeFile && process\.env\.THEIA_FULL_SCHOOL_SCHEDULE_SCAN === '1'\)/)
  assert.match(mainSource, /'getSnapshot', 'getAdvisorOverview', 'getAuthStatus'/)
  assert.match(mainSource, /\.getAdvisorOverview\(\)/)
  assert.match(mainSource, /advisorOverview\.schema === 'theia-advisor-overview\/v1'/)
  assert.match(mainSource, /const mainWebContentsId = window\.webContents\.id[\s\S]*?details\.webContentsId === mainWebContentsId/)
  assert.match(smokeSource, /child\.once\('close'/)
  assert.match(smokeSource, /\[THEIA\\\] \(\?:uncaught exception\|unhandled rejection\):/)
  assert.match(smokeSource, /\|\| runtimeError/)
})

test('JPEG source sanitization removes metadata without changing image segments', () => {
  const metadata = Buffer.from('Exif\0\0LOCAL-BUILD-USER')
  const app1 = Buffer.concat([Buffer.from([0xff, 0xe1, 0, metadata.length + 2]), metadata])
  const imageHeader = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0, 4, 1, 2])
  const scan = Buffer.from([0xff, 0xda, 0, 2, 3, 4, 0xff, 0xd9])
  const input = Buffer.concat([imageHeader, app1, scan])

  const result = stripJpegMetadata(input)
  assert.equal(result.removedSegments, 1)
  assert.deepEqual(result.data, Buffer.concat([imageHeader, scan]))
  assert.equal(result.data.includes(Buffer.from('LOCAL-BUILD-USER')), false)
})
