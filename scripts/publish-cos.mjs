import { createHash, createHmac } from 'node:crypto'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'

export const PROJECT_ROOT = resolve(import.meta.dirname, '..')
export const COS_BUCKET = 'theia-1314083262'
export const COS_REGION = 'ap-beijing'
export const COS_PREFIX = 'stable'
export const COS_CONFIG_PATH = resolve(process.env.APPDATA || process.env.LOCALAPPDATA || PROJECT_ROOT, 'THEIA', 'cos-publish.json')

function encode(value) {
  return encodeURIComponent(String(value ?? ''))
    .replace(/!/g, '%21')
    .replace(/'/g, '%27')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29')
    .replace(/\*/g, '%2A')
}

function sortedPairs(values = {}) {
  return Object.entries(values)
    .map(([key, value]) => [String(key).toLowerCase(), String(value ?? '').trim()])
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${encode(key)}=${encode(value)}`)
    .join('&')
}

function sha1(value) {
  return createHash('sha1').update(value).digest('hex')
}

function hmacSha1(key, value) {
  return createHmac('sha1', key).update(value).digest('hex')
}

export function cosHost(bucket = COS_BUCKET, region = COS_REGION) {
  return `${bucket}.cos.${region}.myqcloud.com`
}

export function cosObjectUrl(key, { bucket = COS_BUCKET, region = COS_REGION } = {}) {
  const path = String(key || '')
    .split('/')
    .filter(Boolean)
    .map((part) => encode(part))
    .join('/')
  return `https://${cosHost(bucket, region)}/${path}`
}

export function buildCosAuthorization({
  secretId,
  secretKey,
  method = 'PUT',
  uriPath,
  headers = {},
  params = {},
  nowSeconds = Math.floor(Date.now() / 1000),
  durationSeconds = 900,
} = {}) {
  if (!secretId || !secretKey || !uriPath) throw new Error('COS 签名参数不完整')
  const start = Number(nowSeconds)
  const end = start + Math.max(60, Number(durationSeconds) || 900)
  const signTime = `${start};${end}`
  const headerPairs = sortedPairs(headers)
  const paramPairs = sortedPairs(params)
  const httpString = [
    String(method).toLowerCase(),
    uriPath,
    paramPairs,
    headerPairs,
    '',
  ].join('\n')
  const stringToSign = [
    'sha1',
    signTime,
    sha1(httpString),
    '',
  ].join('\n')
  const signKey = hmacSha1(secretKey, signTime)
  const signature = hmacSha1(signKey, stringToSign)
  return [
    'q-sign-algorithm=sha1',
    `q-ak=${encode(secretId)}`,
    `q-sign-time=${signTime}`,
    `q-key-time=${signTime}`,
    `q-header-list=${Object.keys(headers).map((key) => key.toLowerCase()).sort().join(';')}`,
    `q-url-param-list=${Object.keys(params).map((key) => key.toLowerCase()).sort().join(';')}`,
    `q-signature=${signature}`,
  ].join('&')
}

export function normalizeCosConfig(value = {}) {
  const bucket = String(value.bucket || COS_BUCKET).trim()
  const region = String(value.region || COS_REGION).trim()
  const secretId = String(value.secretId || '').trim()
  const secretKey = String(value.secretKey || '').trim()
  if (!/^[a-z0-9][a-z0-9-]{1,48}$/i.test(bucket)) throw new Error('COS Bucket 格式无效')
  if (!/^[a-z0-9-]+$/i.test(region)) throw new Error('COS Region 格式无效')
  if (!secretId || !secretKey) throw new Error('尚未配置 COS SecretId/SecretKey')
  return { bucket, region, secretId, secretKey }
}

function powershellTransform(script, input) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn('powershell.exe', [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script,
    ], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += String(chunk) })
    child.stderr.on('data', (chunk) => { stderr += String(chunk) })
    child.once('error', reject)
    child.once('close', (code) => {
      if (code === 0) resolvePromise(stdout.trim())
      else reject(new Error(`Windows 凭据保护失败${stderr.trim() ? `：${stderr.trim().slice(0, 300)}` : ''}`))
    })
    child.stdin.end(input)
  })
}

async function protectCredentials(secretId, secretKey) {
  const payload = `${secretId}\n${secretKey}`
  return powershellTransform(
    'Add-Type -AssemblyName System.Security; $value = [Console]::In.ReadToEnd(); $bytes = [Text.Encoding]::UTF8.GetBytes($value); $protected = [Security.Cryptography.ProtectedData]::Protect($bytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser); [Convert]::ToBase64String($protected)',
    payload,
  )
}

async function unprotectCredentials(ciphertext) {
  return powershellTransform(
    'Add-Type -AssemblyName System.Security; $value = [Console]::In.ReadToEnd().Trim(); $protected = [Convert]::FromBase64String($value); $bytes = [Security.Cryptography.ProtectedData]::Unprotect($protected, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser); [Text.Encoding]::UTF8.GetString($bytes)',
    ciphertext,
  )
}

export async function loadCosConfig({ configPath = COS_CONFIG_PATH, env = process.env } = {}) {
  const envConfig = {
    bucket: env.THEIA_COS_BUCKET,
    region: env.THEIA_COS_REGION,
    secretId: env.THEIA_COS_SECRET_ID,
    secretKey: env.THEIA_COS_SECRET_KEY,
  }
  if (envConfig.secretId && envConfig.secretKey) return normalizeCosConfig(envConfig)
  let stored
  try {
    stored = JSON.parse(await readFile(configPath, 'utf8'))
  } catch (error) {
    if (error?.code === 'ENOENT') throw new Error(`未找到 COS 本地配置，请先运行 npm run cos:configure（配置文件：${configPath}）`)
    throw new Error(`COS 本地配置无法读取：${error?.message || error}`)
  }
  if (stored?.credentials?.dpapi) {
    const plaintext = await unprotectCredentials(stored.credentials.dpapi)
    const splitAt = plaintext.indexOf('\n')
    if (splitAt <= 0) throw new Error('COS 本地凭据格式无效')
    return normalizeCosConfig({
      bucket: stored.bucket,
      region: stored.region,
      secretId: plaintext.slice(0, splitAt),
      secretKey: plaintext.slice(splitAt + 1),
    })
  }
  throw new Error('COS 本地配置缺少 Windows DPAPI 凭据，请重新运行 npm run cos:configure')
}

export async function saveCosConfig({ secretId, secretKey, bucket = COS_BUCKET, region = COS_REGION, configPath = COS_CONFIG_PATH } = {}) {
  const config = normalizeCosConfig({ secretId, secretKey, bucket, region })
  const ciphertext = await protectCredentials(config.secretId, config.secretKey)
  await mkdir(dirname(configPath), { recursive: true })
  await writeFile(configPath, `${JSON.stringify({
    version: 1,
    bucket: config.bucket,
    region: config.region,
    credentials: { protection: 'windows-dpapi', dpapi: ciphertext },
  }, null, 2)}\n`, 'utf8')
  return { path: configPath, bucket: config.bucket, region: config.region }
}

function contentType(path) {
  if (/\.yml$/i.test(path)) return 'text/yaml'
  if (/\.blockmap$/i.test(path)) return 'application/json'
  if (/\.zip$/i.test(path)) return 'application/zip'
  return 'application/octet-stream'
}

async function uploadObject(config, key, path, { fetchImpl = fetch, nowSeconds } = {}) {
  const body = await readFile(path)
  const type = contentType(path)
  const host = cosHost(config.bucket, config.region)
  const uriPath = `/${key.split('/').filter(Boolean).map((part) => encode(part)).join('/')}`
  const headers = { 'content-type': type }
  const authorization = buildCosAuthorization({
    secretId: config.secretId,
    secretKey: config.secretKey,
    method: 'PUT',
    uriPath,
    headers,
    nowSeconds,
  })
  const response = await fetchImpl(cosObjectUrl(key, config), {
    method: 'PUT',
    headers: {
      Host: host,
      'Content-Type': type,
      Authorization: authorization,
    },
    body,
  })
  if (!response.ok) {
    const detail = typeof response.text === 'function' ? (await response.text()).replace(/\s+/g, ' ').slice(0, 300) : ''
    throw new Error(`COS 上传失败 ${key} (${response.status})${detail ? `：${detail}` : ''}`)
  }
  return { key, path, bytes: body.length, url: cosObjectUrl(key, config) }
}

export async function publishCosArtifacts({
  projectRoot = PROJECT_ROOT,
  version,
  config,
  configPath = COS_CONFIG_PATH,
  fetchImpl = fetch,
  nowSeconds = Math.floor(Date.now() / 1000),
} = {}) {
  const resolvedConfig = config ? normalizeCosConfig(config) : await loadCosConfig({ configPath })
  const manifest = JSON.parse(await readFile(resolve(projectRoot, 'package.json'), 'utf8'))
  const releaseVersion = String(version || manifest.version || '').trim()
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(releaseVersion)) throw new Error(`版本号无效：${releaseVersion}`)
  const releaseDirectory = resolve(projectRoot, 'release-bin')
  const names = [
    `THEIA-${releaseVersion}-x64-win.exe`,
    `THEIA-${releaseVersion}-x64-win.exe.blockmap`,
    'latest.yml',
    `THEIA-${releaseVersion}-source.zip`,
  ]
  const results = []
  for (const name of names) {
    const path = resolve(releaseDirectory, name)
    await stat(path)
    results.push(await uploadObject(resolvedConfig, `${COS_PREFIX}/${name}`, path, { fetchImpl, nowSeconds }))
  }
  return { ...resolvedConfig, version: releaseVersion, results }
}

function prompt(question) {
  const input = createInterface({ input: process.stdin, output: process.stdout })
  return new Promise((resolvePromise) => input.question(question, (answer) => {
    input.close()
    resolvePromise(answer.trim())
  }))
}

async function configureFromTerminal() {
  const secretId = await prompt('腾讯云 SecretId（仅写入本机加密配置）：')
  const secretKey = await prompt('腾讯云 SecretKey（仅写入本机加密配置）：')
  const result = await saveCosConfig({ secretId, secretKey })
  process.stdout.write(`COS 本地配置已保存：${result.path}\n桶：${result.bucket}\n地域：${result.region}\n`)
}

async function main() {
  const command = process.argv[2] || 'publish'
  if (command === 'configure') return configureFromTerminal()
  if (command === 'publish') {
    const result = await publishCosArtifacts()
    for (const item of result.results) process.stdout.write(`已上传 ${item.key} (${item.bytes} bytes)\n`)
    process.stdout.write(`COS 更新目录：https://${cosHost(result.bucket, result.region)}/${COS_PREFIX}/\n`)
    return
  }
  throw new Error(`未知命令：${command}，可用命令：configure、publish`)
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : ''
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error?.stack || error}\n`)
    process.exitCode = 1
  })
}
