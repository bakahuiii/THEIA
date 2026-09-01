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
const settingsStyles = await read('../src/styles/settings-current.css')
const authorAvatar = await readFile(new URL('../src/assets/bakahuiii-avatar.jpg', import.meta.url))

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

test('About keeps only the contact details and avatar in its personal section', () => {
  assert.match(about, /authorAvatar/)
  assert.match(about, /<h3 id="about-me-title">关于我<\/h3>/)
  assert.match(about, /alt="头像"/)
  assert.match(about, /1411575779@qq\.com/)
  assert.match(about, /QQ 1411575779/)
  assert.match(about, /微信 bakahui0225/)
  assert.match(about, /mailto:1411575779@qq\.com/)
  assert.match(about, /about-me-avatar/)
  assert.match(about, /about-brand-row/)
  assert.ok(about.indexOf('className="about-hero"') < about.indexOf('className="about-me"'))
  assert.doesNotMatch(about, /项目作者|作者联系方式|THEIA \/ CAMPUS CLIENT|我做 THEIA|为北化学生/)
  assert.match(settingsStyles, /\.about-me-avatar-shell\s*\{[\s\S]*?overflow:\s*hidden[\s\S]*?border-radius:\s*25px/)
  assert.match(settingsStyles, /\.about-me-avatar\s*\{[\s\S]*?width:\s*100%[\s\S]*?height:\s*100%[\s\S]*?object-fit:\s*cover/)
  assert.match(settingsStyles, /\.about-me-contacts a,[\s\S]*?font-size:\s*13px/)
  assert.match(settingsStyles, /\.about-brand-row\s*\{[\s\S]*?display:\s*grid[\s\S]*?grid-template-columns:\s*minmax\(250px, 4fr\) minmax\(0, 6fr\)/)
  assert.equal(authorAvatar[0], 0xff)
  assert.equal(authorAvatar[1], 0xd8)
  assert.ok(authorAvatar.length < 100 * 1024)
})
