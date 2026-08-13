import assert from 'node:assert/strict'
import test from 'node:test'
import { markdownDocument, renderSafeMarkdown } from '../core/markdown-html.mjs'

test('safe markdown keeps document structure and strips executable HTML', async () => {
  const html = await renderSafeMarkdown(`
# Result

| Item | Value |
| --- | --- |
| Safe | **yes** |

<script>globalThis.compromised = true</script>
<img src="https://example.invalid/tracker.png" onerror="globalThis.compromised = true">
<a href="javascript:globalThis.compromised=true" onclick="globalThis.compromised=true">unsafe</a>
`)

  assert.match(html, /<h1>Result<\/h1>/)
  assert.match(html, /<table>/)
  assert.match(html, /<strong>yes<\/strong>/)
  assert.doesNotMatch(html, /<script|onerror|onclick|javascript:|example\.invalid/i)
  assert.match(html, />unsafe<\/a>/)
})

test('PDF HTML applies a network-denying CSP and escapes its title', async () => {
  const html = await markdownDocument('hello', {
    title: '<img src=x onerror=alert(1)>',
    css: 'body { color: black; }',
  })

  assert.match(html, /default-src 'none'; img-src data:; style-src 'unsafe-inline'/)
  assert.match(html, /<title>&lt;img src=x onerror=alert\(1\)&gt;<\/title>/)
  assert.match(html, /<style>body \{ color: black; \}<\/style>/)
})
