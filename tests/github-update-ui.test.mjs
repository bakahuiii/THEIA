import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8')
const indicator = await read('../src/components/GithubUpdateIndicator.tsx')
const hook = await read('../src/hooks/useGithubUpdateStatus.ts')
const app = await read('../src/App.tsx')
const chrome = await read('../src/layout/WorkspaceChrome.tsx')
const about = await read('../src/views/settings/AboutSettings.tsx')
const styles = await read('../src/styles/topbar-status.css')

test('auto-update indicator renders every background update phase', () => {
  for (const state of ['checking', 'available', 'downloading', 'downloaded', 'error']) {
    assert.match(indicator, new RegExp(`case "${state}"`))
  }
  assert.match(indicator, /transferredBytes/)
  assert.match(indicator, /totalBytes/)
  assert.match(indicator, /bytesPerSecond/)
  assert.match(indicator, /createPortal/)
  assert.match(indicator, /bridge\.downloadUpdate\(\)/)
  assert.match(indicator, /bridge\.skipUpdateVersion\(\)/)
  assert.match(indicator, /更新/)
  assert.match(indicator, /跳过版本/)
  assert.match(indicator, /role="progressbar"/)
  assert.match(indicator, /aria-valuenow=\{downloading \? Math\.round\(progress\)/)
  assert.match(styles, /\.github-update-indicator\s*\{[\s\S]*position:\s*fixed/)
  assert.match(styles, /\.github-update-progress\.is-indeterminate[\s\S]*github-update-progress-slide/)
})

test('auto-update status is subscribed at the app shell and reused in About', () => {
  assert.match(hook, /bridge\.getUpdateStatus\(\)/)
  assert.match(hook, /bridge\.onUpdateStatus\?\./)
  assert.match(app, /useGithubUpdateStatus\(\)/)
  assert.match(app, /updateStatus=\{updateStatus\}/)
  assert.match(chrome, /<GithubUpdateIndicator status=\{updateStatus\} \/>/)
  assert.match(about, /useGithubUpdateStatus\(state\.appVersion \|\| "web"\)/)
  assert.match(about, /about-update-progress/)
  assert.match(about, /updateSizeBytes/)
  assert.match(about, /文件大小：/)
  assert.match(about, /bridge\.downloadUpdate\(\)/)
})

test('About introduces the Android client with its public repository link', () => {
  assert.match(about, /THEIA-Android/)
  assert.match(about, /https:\/\/github\.com\/bakahuiii\/THEIA-Android/)
  assert.match(about, /Android 10\+/)
  assert.match(about, /target="_blank"/)
})
