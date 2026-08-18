import { createRequire } from 'node:module'
import { dirname } from 'node:path'

const require = createRequire(import.meta.url)

function bundledDirectory(resource) {
  return `${dirname(require.resolve(resource)).replace(/\\/g, '/')}/`
}

/**
 * PDF.js needs the bundled Adobe CMaps to decode Zhengfang's UniGB text.
 * Keep this configuration local and deterministic so extraction never depends
 * on a system installation or a network request.
 */
export function pdfTextLoadOptions() {
  return {
    cMapUrl: bundledDirectory('pdfjs-dist/cmaps/UniGB-UCS2-H.bcmap'),
    cMapPacked: true,
    standardFontDataUrl: bundledDirectory('pdfjs-dist/standard_fonts/FoxitDingbats.pfb'),
    useWorkerFetch: false,
  }
}
