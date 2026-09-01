import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8')
const interfaceView = await read('../src/views/settings/InterfaceSettings.tsx')
const aboutView = await read('../src/views/settings/AboutSettings.tsx')
const sidebar = await read('../src/layout/AppSidebar.tsx')
const demo = await read('../src/demo.ts')
const settingsView = await read('../src/views/SettingsView.tsx')
const settingsStyles = await read('../src/styles/settings-current.css')
const legacyCoreStyles = await read('../src/styles/legacy-core.css')
const foundationStyles = await read('../src/styles/foundation.css')

test('settings interface is runtime-backed and describes the read-only boundary', () => {
  assert.match(interfaceView, /status\.apiEndpoints/)
  assert.match(interfaceView, /status\.mcp/)
  assert.match(interfaceView, /127\.0\.0\.1 回环地址/)
  assert.match(interfaceView, /Bearer Token/)
  assert.doesNotMatch(interfaceView, /GET \/v1\/snapshot.*完整规范化数据/)
})

test('frontend version and API address do not fall back to stale values', () => {
  assert.doesNotMatch(aboutView, /state\.settings\.apiPort/)
  assert.doesNotMatch(sidebar, /state\.settings\.apiPort/)
  assert.match(demo, /import packageManifest from "\.\.\/package\.json"/)
  assert.match(demo, /appVersion: packageManifest\.version/)
})

test('settings navigation and About expose explicit icon states', () => {
  assert.match(settingsView, /settings-nav-icon/)
  assert.match(settingsView, /id === "sync" && syncing/)
  assert.match(settingsView, /strokeWidth=\{activeSection === id \? 2\.2 : 1\.8\}/)
  assert.match(settingsView, /aria-hidden="true"/)
  assert.match(aboutView, /updateInProgress = .*"checking".*"downloading"/s)
  assert.match(aboutView, /updateStatus\.state === "available"[\s\S]*?"准备下载"/)
  assert.match(aboutView, /disabled=\{!updateStatus\.supported \|\| updateInProgress\}/)
  assert.match(aboutView, /about-update is-\$\{updateTone\(updateStatus\)\}/)
  assert.match(aboutView, /const ActionIcon =/)
  assert.match(aboutView, /<ActionIcon size=\{16\}/)
  assert.match(aboutView, /about-fact-api \$\{apiOnline \? "is-online" : "is-offline"\}/)
  assert.match(settingsStyles, /\.settings-modal-nav button\.active > svg\.settings-nav-icon[\s\S]*?var\(--sidebar-primary\)/)
  assert.match(settingsStyles, /\.about-update\.is-error \.about-update-icon/)
  assert.match(settingsStyles, /\.about-update\.is-ready \.about-update-icon/)
  assert.match(settingsStyles, /\.about-mark\s*\{[\s\S]*?overflow:\s*hidden/)
  assert.match(settingsStyles, /\.about-mark img\s*\{[\s\S]*?width:\s*100%[\s\S]*?height:\s*100%[\s\S]*?object-fit:\s*cover[\s\S]*?border-radius:\s*24%/)
  assert.match(settingsStyles, /\.settings-dialog-scroll \.settings-icon\s*\{[\s\S]*?flex:\s*0 0 39px/)
  assert.match(settingsStyles, /\.settings-dialog-scroll \.settings-icon\s*\{[\s\S]*?width:\s*39px[\s\S]*?height:\s*39px/)
  assert.match(settingsStyles, /\.settings-dialog-scroll \.data-connection-card-header \.settings-icon\s*\{[\s\S]*?width:\s*38px[\s\S]*?height:\s*38px/)
  assert.match(settingsStyles, /\.brand-mark\s*\{[\s\S]*?border-color:\s*color-mix/)
})

test('legacy brand icon styles do not restore the retired brown treatment', () => {
  assert.doesNotMatch(legacyCoreStyles, /#b86b2a|rgba\(151, 79, 27, \.22\)/)
  assert.doesNotMatch(foundationStyles, /#dcc6b5|rgba\(85, 43, 19, \.6\)/)
})
