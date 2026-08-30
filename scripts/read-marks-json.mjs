import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

const dir = join(process.env.APPDATA, "THEIA", "session", "Local Storage", "leveldb")
const files = readdirSync(dir).filter((f) => f.endsWith(".log"))

for (const file of files) {
  const buf = readFileSync(join(dir, file))
  // Find every occurrence of the storage key (UTF-8 in the leveldb record).
  const keyBytes = Buffer.from("theia-campus-building-marks-v1", "utf8")
  const occurrences = []
  let from = 0
  while (true) {
    const i = buf.indexOf(keyBytes, from)
    if (i < 0) break
    occurrences.push(i)
    from = i + 1
  }
  console.log(`=== ${file}: ${occurrences.length} occurrences of key`)
  occurrences.forEach((idx, n) => {
    // After the key bytes: value length varint + value bytes (UTF-16LE JSON).
    let pos = idx + keyBytes.length
    // Chromium writes value as UTF-16LE; try decoding from here.
    const candidate = buf.toString("utf16le", pos, Math.min(buf.length, pos + 6000))
    const arrStart = candidate.indexOf("[")
    const arrEnd = candidate.lastIndexOf("]")
    if (arrStart < 0 || arrEnd <= arrStart) {
      console.log(`  #${n} at ${idx}: no JSON array after key`)
      return
    }
    const raw = candidate.slice(arrStart, arrEnd + 1)
    try {
      const marks = JSON.parse(raw)
      console.log(`  #${n} at ${idx}: ${marks.length} marks`)
      marks.forEach((m) => console.log(`    key=${m.key} name=${m.name || ""} (${m.x},${m.y})`))
    } catch (e) {
      console.log(`  #${n} at ${idx}: parse error ${e.message}; raw=${raw.slice(0, 300)}`)
    }
  })
}
