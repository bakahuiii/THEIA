import test from 'node:test'
import assert from 'node:assert/strict'
import {
  isPermittedAppNavigation,
  isPermittedExternalUrl,
  isPermittedSourceDownloadUrl,
  permittedAcademicApiUrl,
  isPermittedSourceUrl,
  permittedExternalUrl,
  permittedSourceUrl,
} from '../core/source-url-policy.mjs'

test('source URL policy accepts only HTTPS campus hosts', () => {
  for (const url of [
    'https://buct.edu.cn/',
    'https://course.buct.edu.cn/meol/',
  ]) {
    assert.equal(isPermittedSourceUrl(url), true, url)
    assert.equal(permittedSourceUrl(url), new URL(url).toString())
  }
})

test('source URL policy rejects arbitrary protocols, credentials, and lookalike hosts', () => {
  for (const url of [
    'file://course.buct.edu.cn/C:/Windows/win.ini',
    'ftp://course.buct.edu.cn/archive',
    'javascript://course.buct.edu.cn/%0Aalert(1)',
    'data://course.buct.edu.cn/text/html,hello',
    'https://buct.edu.cn.evil.example/',
    'https://buct.edu.cn@evil.example/',
    'https://user@course.buct.edu.cn/',
    'http://jwglxt.buct.edu.cn/jwglxt/',
    'http://buct.edu.cn/',
    'http://127.0.0.1:8765/v1/health',
    'http://localhost:5174/',
    'http://127.0.0.1.evil.example/',
    'not a URL',
  ]) {
    assert.equal(isPermittedSourceUrl(url), false, url)
    assert.throws(() => permittedSourceUrl(url), /HTTPS.*buct\.edu\.cn/)
  }
})

test('external URL policy allows credential-free HTTP(S) links only', () => {
  for (const url of ['https://example.com/a', 'http://127.0.0.1:8765/v1/health']) {
    assert.equal(isPermittedExternalUrl(url), true, url)
    assert.equal(permittedExternalUrl(url), new URL(url).toString())
  }
  for (const url of ['file:///C:/Windows/win.ini', 'javascript:alert(1)', 'https://user@example.com/']) {
    assert.equal(isPermittedExternalUrl(url), false, url)
    assert.throws(() => permittedExternalUrl(url), /HTTP\(S\)/)
  }
})

test('app navigation remains on its exact packaged document or development origin', () => {
  assert.equal(isPermittedAppNavigation('file:///C:/THEIA/resources/app.asar/dist/index.html#calendar', 'file:///C:/THEIA/resources/app.asar/dist/index.html'), true)
  assert.equal(isPermittedAppNavigation('file:///C:/THEIA/resources/app.asar/dist/other.html', 'file:///C:/THEIA/resources/app.asar/dist/index.html'), false)
  assert.equal(isPermittedAppNavigation('http://127.0.0.1:5174/tools', 'http://127.0.0.1:5174/'), true)
  assert.equal(isPermittedAppNavigation('http://127.0.0.1:8765/v1/feed', 'http://127.0.0.1:5174/'), false)
  assert.equal(isPermittedAppNavigation('https://example.com/', 'http://127.0.0.1:5174/'), false)
})

test('school browser downloads may use campus HTTPS or a campus-owned blob URL', () => {
  assert.equal(isPermittedSourceDownloadUrl('https://jwglxt.buct.edu.cn/download/schedule.pdf'), true)
  assert.equal(isPermittedSourceDownloadUrl('blob:https://jwglxt.buct.edu.cn/ea0c4ae5-12d1-4c27-a49f'), true)
  assert.equal(isPermittedSourceDownloadUrl('blob:https://example.com/ea0c4ae5-12d1-4c27-a49f'), false)
  assert.equal(isPermittedSourceDownloadUrl('data:application/pdf;base64,JVBERg=='), false)
})

test('academic API policy stays on the exact academic system host', () => {
  assert.equal(permittedAcademicApiUrl('https://jwglxt.buct.edu.cn/jwglxt/'), 'https://jwglxt.buct.edu.cn/jwglxt/')
  assert.throws(() => permittedAcademicApiUrl('https://course.buct.edu.cn/meol/'), /jwglxt\.buct\.edu\.cn/)
})
