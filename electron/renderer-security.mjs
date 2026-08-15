export const MAIN_RENDERER_CSP_PRODUCTION = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: theia-background: theia-calendar:",
  "font-src 'self' data:",
  // GLTFLoader's ImageBitmapLoader fetches embedded GLB textures through
  // in-memory blob URLs. This does not grant network access, but is required
  // for bundled WebGL scenes to retain their source textures.
  "connect-src 'self' blob:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "frame-src 'self' theia-calendar:",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ')

export const MAIN_RENDERER_CSP_DEVELOPMENT = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: theia-background: theia-calendar:",
  "font-src 'self' data:",
  "connect-src 'self' blob: ws://127.0.0.1:*",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "frame-src 'self' theia-calendar:",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ')

export function mainRendererCsp(development) {
  return development ? MAIN_RENDERER_CSP_DEVELOPMENT : MAIN_RENDERER_CSP_PRODUCTION
}

export function mainRendererMetaCsp(development) {
  return mainRendererCsp(development)
    .split(';')
    .map((directive) => directive.trim())
    .filter((directive) => !directive.startsWith('frame-ancestors '))
    .join('; ')
}
