import { marked } from 'marked'
import sanitizeHtml from 'sanitize-html'

const ALLOWED_TAGS = [
  'a', 'blockquote', 'br', 'code', 'del', 'em', 'h1', 'h2', 'h3', 'h4',
  'h5', 'h6', 'hr', 'img', 'li', 'ol', 'p', 'pre', 'strong', 'table',
  'tbody', 'td', 'th', 'thead', 'tr', 'ul',
]

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character])
}

export async function renderSafeMarkdown(markdown) {
  const rendered = await marked.parse(String(markdown ?? ''), {
    async: false,
    breaks: false,
    gfm: true,
  })
  return sanitizeHtml(rendered, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: {
      a: ['href', 'title'],
      img: ['alt', 'src', 'title'],
      td: ['align'],
      th: ['align'],
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    allowedSchemesByTag: { img: ['data'] },
    allowProtocolRelative: false,
    exclusiveFilter(frame) {
      if (frame.tag !== 'img') return false
      return !/^data:image\/(?:gif|jpeg|png|webp);base64,[a-z0-9+/]+=*$/i.test(frame.attribs.src || '')
    },
  })
}

export async function markdownDocument(markdown, { title = '文档', css = '' } = {}) {
  const htmlBody = await renderSafeMarkdown(markdown)
  return `<!DOCTYPE html><html><head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">
<meta name="referrer" content="no-referrer">
<title>${escapeHtml(title)}</title>
<style>${css}</style>
</head><body>${htmlBody}</body></html>`
}
