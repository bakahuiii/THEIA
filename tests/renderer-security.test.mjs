import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  MAIN_RENDERER_CSP_DEVELOPMENT,
  MAIN_RENDERER_CSP_PRODUCTION,
  mainRendererMetaCsp,
} from '../electron/renderer-security.mjs'

test('production renderer CSP disables network and active embedding', () => {
  assert.match(MAIN_RENDERER_CSP_PRODUCTION, /connect-src 'none'/)
  assert.match(MAIN_RENDERER_CSP_PRODUCTION, /script-src 'self'/)
  assert.match(MAIN_RENDERER_CSP_PRODUCTION, /object-src 'none'/)
  assert.match(MAIN_RENDERER_CSP_PRODUCTION, /frame-src 'self' theia-calendar:/)
  assert.doesNotMatch(MAIN_RENDERER_CSP_PRODUCTION, /https?:|wss?:|unsafe-eval/)
})

test('development renderer CSP adds only loopback Vite websocket connectivity', () => {
  assert.match(MAIN_RENDERER_CSP_DEVELOPMENT, /connect-src 'self' ws:\/\/127\.0\.0\.1:\*/)
  assert.doesNotMatch(MAIN_RENDERER_CSP_DEVELOPMENT, /https?:\/\//)
  assert.doesNotMatch(MAIN_RENDERER_CSP_DEVELOPMENT, /wss?:\/\/(?:localhost|\[::1\]|(?!127\.0\.0\.1))/)
  assert.doesNotMatch(MAIN_RENDERER_CSP_DEVELOPMENT, /unsafe-eval/)
})

test('main document uses an external appearance bootstrap and Vite emits the CSP', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8')
  const vite = await readFile(new URL('../vite.config.ts', import.meta.url), 'utf8')
  assert.match(html, /Content-Security-Policy[^>]+__THEIA_MAIN_CSP__/)
  assert.match(html, /src="\/src\/appearance-bootstrap\.ts"/)
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/i)
  assert.match(vite, /mainRendererMetaCsp\(command === 'serve'\)/)
  assert.match(MAIN_RENDERER_CSP_PRODUCTION, /frame-ancestors 'none'/)
  assert.doesNotMatch(mainRendererMetaCsp(false), /frame-ancestors/)
})

test('mail srcDoc remains sandboxed under its own network-denying CSP', async () => {
  const source = await readFile(new URL('../src/views/MailboxView.tsx', import.meta.url), 'utf8')
  assert.match(source, /sandbox="allow-same-origin allow-popups"/)
  assert.doesNotMatch(source, /sandbox="[^"]*allow-scripts/)
  assert.match(source, /default-src 'none'; img-src data:/)
  assert.match(source, /connect-src 'none'/)
})
