import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { execFile, spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

export const PROJECT_ROOT = resolve(import.meta.dirname, '..')
export const RELEASE_DIRECTORY = resolve(PROJECT_ROOT, 'release-bin')

function npmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm'
}

function run(command, args, { cwd = PROJECT_ROOT } = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd, env: process.env, stdio: 'inherit' })
    child.once('error', reject)
    child.once('close', (code, signal) => {
      if (code === 0) resolvePromise()
      else reject(new Error(`${command} ${args.join(' ')} failed${signal ? ` (${signal})` : ` with exit code ${code}`}`))
    })
  })
}

function capture(command, args, { cwd = PROJECT_ROOT, allowFailure = false } = {}) {
  return new Promise((resolvePromise, reject) => {
    execFile(command, args, { cwd, env: process.env, maxBuffer: 2 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (!error) {
        resolvePromise({ code: 0, stdout: String(stdout || ''), stderr: String(stderr || '') })
        return
      }
      if (allowFailure) {
        resolvePromise({ code: Number(error.code) || 1, stdout: String(stdout || ''), stderr: String(stderr || '') })
        return
      }
      reject(error)
    })
  })
}

async function sha256(path) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex').toUpperCase()
}

export async function inspectArtifact(path, description) {
  const info = await stat(path)
  return {
    name: path.split(/[\\/]/).at(-1),
    path,
    description,
    bytes: info.size,
    sha256: await sha256(path),
  }
}

export function renderReleaseDocument(markdown, {
  version,
  artifacts = [],
  sourcePending = false,
  published = false,
  releaseUrl = null,
} = {}) {
  const marker = '\n## 发布状态'
  const markerIndex = String(markdown || '').indexOf(marker)
  const base = (markerIndex >= 0 ? String(markdown).slice(0, markerIndex) : String(markdown)).trimEnd()
  const lines = ['## 发布文件', '']
  for (const artifact of artifacts) {
    lines.push(`- \`${artifact.name}\` — ${artifact.description}，${artifact.bytes} bytes，SHA-256 \`${artifact.sha256}\``)
  }
  if (sourcePending) lines.push(`- \`THEIA-${version}-source.zip\` — 源码归档将在安装包验证通过后生成。`)
  lines.push('', '## 发布状态', '')
  if (published) {
    lines.push(`- 已完成 \`${version}\` 源码、构建、打包和 packaged smoke 验收。`)
    lines.push(`- GitHub Release：${releaseUrl || `https://github.com/bakahuiii/THEIA/releases/tag/v${version}`}`)
  } else {
    lines.push(`- 已完成 \`${version}\` 源码、构建、打包和 packaged smoke 验收，等待上传 GitHub Release。`)
  }
  lines.push('')
  return `${base}\n\n${lines.join('\n')}`
}

async function packageJson(projectRoot = PROJECT_ROOT) {
  return JSON.parse(await readFile(resolve(projectRoot, 'package.json'), 'utf8'))
}

async function assertCleanWorktree(projectRoot) {
  const result = await capture('git', ['status', '--porcelain=v1', '--untracked-files=all'], { cwd: projectRoot })
  if (result.stdout.trim()) {
    throw new Error('发布前工作树必须干净，请先提交当前代码和版本说明')
  }
}

async function assertGithubAuth(projectRoot) {
  await run('gh', ['auth', 'status', '--hostname', 'github.com'], { cwd: projectRoot })
}

async function updateReleaseDocument({ projectRoot, version, artifacts, sourcePending, published = false, releaseUrl = null }) {
  const path = resolve(projectRoot, 'docs', 'releases', `v${version}.md`)
  const current = await readFile(path, 'utf8')
  const next = renderReleaseDocument(current, { version, artifacts, sourcePending, published, releaseUrl })
  if (next !== current) await writeFile(path, next, 'utf8')
  return path
}

async function commitReleaseDocument(projectRoot, version, documentPath) {
  const status = await capture('git', ['status', '--short', '--untracked-files=all'], { cwd: projectRoot })
  const lines = status.stdout.trim().split(/\r?\n/).filter(Boolean)
  if (!lines.length) return false
  const relativePath = documentPath.slice(projectRoot.length + 1).replaceAll('\\', '/')
  const onlyDocument = lines.every((line) => line.slice(3).replaceAll('\\', '/') === relativePath)
  if (!onlyDocument) throw new Error(`自动发布只允许更新生成的发行说明，发现其它工作树改动：${status.stdout.trim()}`)
  await run('git', ['add', '--', relativePath], { cwd: projectRoot })
  await run('git', ['commit', '-m', `docs: finalize v${version} release notes`], { cwd: projectRoot })
  return true
}

async function pushBranch(projectRoot) {
  const branch = (await capture('git', ['branch', '--show-current'], { cwd: projectRoot })).stdout.trim()
  if (!branch) throw new Error('不能从 detached HEAD 自动发布')
  await run('git', ['push', 'origin', `HEAD:${branch}`], { cwd: projectRoot })
}

async function ensureTag(projectRoot, version) {
  const tag = `v${version}`
  const head = (await capture('git', ['rev-parse', 'HEAD'], { cwd: projectRoot })).stdout.trim()
  const existing = await capture('git', ['rev-parse', '-q', '--verify', `refs/tags/${tag}`], { cwd: projectRoot, allowFailure: true })
  if (existing.code === 0 && existing.stdout.trim()) {
    const taggedHead = (await capture('git', ['rev-list', '-n', '1', tag], { cwd: projectRoot })).stdout.trim()
    if (taggedHead !== head) throw new Error(`${tag} 已存在但指向其它提交，停止发布`)
  } else {
    await run('git', ['tag', '-a', tag, '-m', `THEIA ${tag}`], { cwd: projectRoot })
  }
  await run('git', ['push', 'origin', `refs/tags/${tag}`], { cwd: projectRoot })
  return tag
}

async function publishGithubRelease({ projectRoot, repository, tag, artifacts, documentPath }) {
  const paths = artifacts.map((artifact) => artifact.path)
  const existing = await capture('gh', ['release', 'view', tag, '--repo', repository, '--json', 'tagName'], { cwd: projectRoot, allowFailure: true })
  if (existing.code === 0) {
    await run('gh', ['release', 'edit', tag, '--repo', repository, '--title', `THEIA ${tag}`, '--notes-file', documentPath], { cwd: projectRoot })
    await run('gh', ['release', 'upload', tag, ...paths, '--repo', repository, '--clobber'], { cwd: projectRoot })
  } else {
    await run('gh', ['release', 'create', tag, ...paths, '--repo', repository, '--title', `THEIA ${tag}`, '--notes-file', documentPath, '--verify-tag'], { cwd: projectRoot })
  }
  return `https://github.com/${repository}/releases/tag/${tag}`
}

export async function release({ projectRoot = PROJECT_ROOT } = {}) {
  const manifest = await packageJson(projectRoot)
  const version = String(manifest.version || '').trim()
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) throw new Error(`Invalid package version: ${version}`)
  const repository = manifest.build?.publish?.find?.((item) => item.provider === 'github')
  if (!repository?.owner || !repository.repo) throw new Error('package.json 缺少 GitHub publish 配置')
  const releaseDirectory = resolve(projectRoot, 'release-bin')

  await assertCleanWorktree(projectRoot)
  await assertGithubAuth(projectRoot)
  await run(npmCommand(), ['run', 'build'], { cwd: projectRoot })
  const builder = resolve(projectRoot, 'node_modules', '.bin', process.platform === 'win32' ? 'electron-builder.cmd' : 'electron-builder')
  await run(builder, ['--win', 'nsis', '--x64', '--publish', 'never'], { cwd: projectRoot })

  const installer = await inspectArtifact(resolve(releaseDirectory, `THEIA-${version}-x64-win.exe`), 'Windows x64 NSIS 安装包')
  const blockmap = await inspectArtifact(resolve(releaseDirectory, `THEIA-${version}-x64-win.exe.blockmap`), 'electron-builder 更新块映射')
  const metadata = await inspectArtifact(resolve(releaseDirectory, 'latest.yml'), 'electron-updater 发布元数据')
  const documentPath = await updateReleaseDocument({ projectRoot, version, artifacts: [installer, blockmap, metadata], sourcePending: true })
  await run(npmCommand(), ['run', 'dist:source'], { cwd: projectRoot })
  await run(npmCommand(), ['run', 'smoke:packaged'], { cwd: projectRoot })

  const source = await inspectArtifact(resolve(releaseDirectory, `THEIA-${version}-source.zip`), '带 SOURCE-MANIFEST.json 的源码归档')
  const artifacts = [installer, blockmap, metadata, source]
  const tag = `v${version}`
  const releaseUrl = `https://github.com/${repository.owner}/${repository.repo}/releases/tag/${tag}`
  await updateReleaseDocument({ projectRoot, version, artifacts, published: true, releaseUrl })
  await commitReleaseDocument(projectRoot, version, documentPath)
  await pushBranch(projectRoot)
  await ensureTag(projectRoot, version)
  await publishGithubRelease({ projectRoot, repository: `${repository.owner}/${repository.repo}`, tag, artifacts, documentPath })
  return { version, tag, releaseUrl, artifacts }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : ''
if (invokedPath === fileURLToPath(import.meta.url)) {
  release()
    .then((result) => {
      process.stdout.write(`${JSON.stringify({ version: result.version, tag: result.tag, releaseUrl: result.releaseUrl, artifacts: result.artifacts.map(({ name, bytes, sha256 }) => ({ name, bytes, sha256 })) }, null, 2)}\n`)
    })
    .catch((error) => {
      process.stderr.write(`${error?.stack || error}\n`)
      process.exitCode = 1
    })
}
