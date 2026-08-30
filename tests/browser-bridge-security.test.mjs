import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  DESKTOP_BRIDGE_UNAVAILABLE_MESSAGE,
  resolveRuntimeBridge,
} from '../src/bridge-runtime.mjs'

const bridgeSource = await readFile(new URL('../src/bridge.ts', import.meta.url), 'utf8')
const appSource = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')
const appHookSource = await readFile(new URL('../src/hooks/useTheiaApp.ts', import.meta.url), 'utf8')

function methodBody(name) {
  const start = bridgeSource.indexOf(`async ${name}(`)
  assert.notEqual(start, -1, `${name} must exist on the browser fallback`)
  const next = bridgeSource.indexOf('\n  async ', start + 1)
  return bridgeSource.slice(start, next === -1 ? bridgeSource.length : next)
}

test('browser fallback rejects desktop mutations instead of reporting false success', () => {
  for (const name of [
    'clearCredentials',
    'clearAcademicApiCredentials',
    'clearMailCredentials',
    'logout',
    'syncNow',
    'stopCourseSelection',
    'clearModelApiKey',
    'updateSettings',
    'openDataDirectory',
    'openScheduleDirectory',
  ]) {
    const body = methodBody(name)
    assert.match(body, /throw new Error\(/, name)
    assert.doesNotMatch(body, /return structuredClone\(|return \{/, name)
  }
})

test('browser fallback does not advertise a local API server that is not running', () => {
  const body = methodBody('getApiStatus')
  assert.match(body, /baseUrl:\s*""/)
  assert.match(body, /port:\s*0/)
  assert.doesNotMatch(body, /127\.0\.0\.1:8765/)
})

test('runtime bridge keeps browser previews but fails closed for packaged file renderers without preload', async () => {
  const nativeBridge = { kind: 'native' }
  const webBridge = { kind: 'web' }

  assert.equal(resolveRuntimeBridge({ protocol: 'file:', nativeBridge, webBridge }), nativeBridge)
  assert.equal(resolveRuntimeBridge({ protocol: 'http:', nativeBridge: undefined, webBridge }), webBridge)
  assert.equal(resolveRuntimeBridge({ protocol: 'https:', nativeBridge: undefined, webBridge }), webBridge)

  const unavailable = resolveRuntimeBridge({
    protocol: 'file:',
    nativeBridge: undefined,
    webBridge,
  })
  await assert.rejects(() => unavailable.getSnapshot(), {
    message: DESKTOP_BRIDGE_UNAVAILABLE_MESSAGE,
  })
  await assert.rejects(() => unavailable.getActivityLog(), {
    message: DESKTOP_BRIDGE_UNAVAILABLE_MESSAGE,
  })
  assert.equal(typeof unavailable.onSnapshot(() => undefined), 'function')
})

test('initial snapshot failures become a visible startup error and do not launch fallback probes', () => {
  const loadStart = appHookSource.indexOf('void bridge\n      .getRendererSnapshot()')
  const runtimeLoaderStart = appHookSource.indexOf('const loadRuntimeStatus', loadStart)
  assert.notEqual(loadStart, -1)
  assert.notEqual(runtimeLoaderStart, -1)
  const initialLoad = appHookSource.slice(loadStart, runtimeLoaderStart)

  assert.match(initialLoad, /setStartupError\(text\)/)
  assert.match(initialLoad, /无法读取本地校园数据/)
  assert.doesNotMatch(initialLoad, /\.finally\(/)
  assert.match(appSource, /role=\{app\.startupError \? "alert" : "status"\}/)
  assert.match(appSource, /app\.startupError \|\| app\.syncProgress/)
})
