import { readFileSync } from "node:fs"
import { join } from "node:path"

const log = join(process.env.APPDATA, "THEIA", "auth-diagnostics.ndjson")
const lines = readFileSync(log, "utf8").split(/\r?\n/)

const seen = new Set()
const marks = []
for (const line of lines) {
  if (!line.includes("[MARK]")) continue
  const m = line.match(/\[MARK\] ([^|]+)\|(\d+)\|(\d+)\|([^"]*)/)
  if (!m) continue
  const rawKey = m[1]
  const x = Number(m[2])
  const y = Number(m[3])
  // The key came from diagnostics JSON, which already decoded the message.
  // The browser console message was UTF-8; the marks were UTF-16LE. Decode:
  // take the raw message bytes from JSON and interpret as UTF-16LE.
  const rawMsg = JSON.parse(line).message
  const rm = rawMsg.match(/\[MARK\] ([^|]+)\|(\d+)\|(\d+)\|([^"]*)/)
  if (!rm) continue
  const decodedKey = decodeMarkKey(rm[1])
  const decodedName = decodeMarkKey(rm[4] || "")
  const k = `${decodedKey}|${x}|${y}`
  if (seen.has(k)) continue
  seen.add(k)
  marks.push({ key: decodedKey, x, y, name: decodedName })
}

function decodeMarkKey(s) {
  // The JSON message is a JS string already holding correct characters; if it
  // looks mojibake (UTF-16 read as UTF-8), re-encode then re-decode.
  try {
    const bytes = Buffer.from(s, "utf8")
    const rebuilt = bytes.toString("utf16le").replace(/\u0000/g, "")
    // If rebuilding produced mostly CJK, use it; otherwise keep original.
    const cjk = (rebuilt.match(/[\u4e00-\u9fff]/g) || []).length
    if (cjk > 0) return rebuilt
  } catch { /* keep original */ }
  return s
}

for (const m of marks) console.log(`${m.key}|${m.x}|${m.y}|${m.name}`)
console.log("TOTAL", marks.length)
