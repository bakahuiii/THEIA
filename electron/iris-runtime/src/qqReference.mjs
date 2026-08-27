/** Returns the opaque QQ reference index for a quote/reply message. */
export function quotedMessageReference(message) {
  const direct = typeof message?.refMsgIdx === 'string' ? message.refMsgIdx.trim() : ''
  if (direct) return direct.slice(0, 256)
  if (Number(message?.msgType ?? message?.raw?.message_type) !== 103) return ''

  const elements = Array.isArray(message?.msgElements)
    ? message.msgElements
    : Array.isArray(message?.raw?.msg_elements) ? message.raw.msg_elements : []
  const elementReference = elements.find((item) => typeof item?.msg_idx === 'string' && item.msg_idx.trim())?.msg_idx
  if (elementReference) return elementReference.trim().slice(0, 256)

  const extensions = Array.isArray(message?.messageScene?.ext)
    ? message.messageScene.ext
    : Array.isArray(message?.raw?.message_scene?.ext) ? message.raw.message_scene.ext : []
  for (const extension of extensions) {
    if (typeof extension !== 'string') continue
    const separator = extension.includes('=') ? '=' : extension.includes(':') ? ':' : ''
    if (!separator) continue
    const [key, ...rest] = extension.split(separator)
    const normalizedKey = key.replace(/[_-]/g, '').trim().toLowerCase()
    const value = rest.join(separator).trim()
    if (normalizedKey === 'refmsgidx' && value) return value.slice(0, 256)
  }
  return ''
}
