import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const component = await readFile(
  new URL('../src/components/SecretInput.tsx', import.meta.url),
  'utf8',
)
const settingsSources = await Promise.all([
  'Credentials.tsx',
  'AcademicDataSourceSettings.tsx',
  'MailboxSettings.tsx',
  'AdvancedModelSettings.tsx',
].map((file) => readFile(new URL(`../src/views/settings/${file}`, import.meta.url), 'utf8')))
const settings = settingsSources.join('\n')
const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8')

test('shared secret input reveals only the current controlled value without submitting its form', () => {
  assert.match(component, /import \{ Eye, EyeOff \} from "lucide-react"/)
  assert.match(component, /type=\{revealed \? "text" : "password"\}/)
  assert.match(component, /type="button"/)
  assert.match(component, /aria-label=\{actionLabel\}/)
  assert.match(component, /aria-pressed=\{revealed\}/)
  assert.match(component, /disabled=\{disabled \|\| loading \|\| !hasSecret\}/)
  assert.match(component, /const secret = await onRevealSaved\(\)/)
  assert.match(component, /setRevealedSavedValue\(null\)/)
  assert.match(component, /readOnly=\{revealedSavedValue !== null/)
})

test('all five settings secrets use the shared visibility control', () => {
  assert.equal(settings.match(/<SecretInput\b/g)?.length, 5)
  assert.doesNotMatch(settings, /type="password"/)
  assert.match(settings, /visibilityLabel="统一身份认证密码"/)
  assert.match(settings, /visibilityLabel="教务系统密码"/)
  assert.match(settings, /visibilityLabel="邮箱密码"/)
  assert.match(settings, /visibilityLabel="客户端授权密码"/)
  assert.match(settings, /visibilityLabel="API Key"/)
  assert.match(settings, /readSavedSecret\("unified-password"\)/)
  assert.match(settings, /readSavedSecret\("academic-api-password"\)/)
  assert.match(settings, /readSavedSecret\("mail-password"\)/)
  assert.match(settings, /readSavedSecret\("mail-protocol-password"\)/)
})

test('secret input styling reserves the eye button and stays stable while revealed', () => {
  assert.match(styles, /\.credential-form \.secret-input\s*\{[^}]*padding-right:\s*40px;/s)
  assert.match(styles, /\.secret-input-toggle\s*\{[^}]*position:\s*absolute;[^}]*inset-block:\s*0;[^}]*width:\s*40px;[^}]*height:\s*auto;/s)
  assert.match(styles, /\.secret-input-toggle:active:not\(:disabled\)\s*\{[^}]*transform:\s*none;/s)
  assert.match(styles, /\.settings-dialog-scroll \.credential-form \.secret-input::placeholder/)
})

test('grade and sync views keep the requested compact controls and complete detail text', async () => {
  const [grades, exams, progress] = await Promise.all([
    readFile(new URL('../src/views/GradesView.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/views/ExamsView.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/views/AcademicProgressView.tsx', import.meta.url), 'utf8'),
  ])
  assert.match(grades, /className="gpa-heading-main"[\s\S]*?<h2>GPA<\/h2>[\s\S]*?gpa-chart-controls/)
  assert.match(exams, /className="view-toolbar exam-toolbar"[\s\S]*?<TermSelector[\s\S]*?exam-visibility-toggle/)
  assert.match(styles, /\.view-toolbar\.exam-toolbar\s*\{[^}]*justify-content:\s*flex-start;/s)
  assert.match(progress, /expandedRequirements\[requirement\.id\] === true/)
  assert.match(styles, /\.sync-domain-row > small\s*\{[^}]*overflow:\s*visible;[^}]*white-space:\s*normal;/s)
})
