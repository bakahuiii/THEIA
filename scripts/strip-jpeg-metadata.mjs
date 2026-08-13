import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const STANDALONE_MARKERS = new Set([0x01, 0xd8, 0xd9, 0xd0, 0xd1, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7])
const METADATA_MARKERS = new Set([0xe1, 0xed, 0xfe]) // APP1 (EXIF/XMP), APP13 (IPTC), COM

export function stripJpegMetadata(input) {
  if (!Buffer.isBuffer(input) || input.length < 4 || input[0] !== 0xff || input[1] !== 0xd8) {
    throw new Error('Input is not a JPEG file')
  }

  const output = [input.subarray(0, 2)]
  let offset = 2
  let removedSegments = 0
  while (offset < input.length) {
    const markerStart = offset
    if (input[offset] !== 0xff) throw new Error(`Invalid JPEG marker at byte ${offset}`)
    while (offset < input.length && input[offset] === 0xff) offset += 1
    if (offset >= input.length) throw new Error('Truncated JPEG marker')

    const marker = input[offset]
    offset += 1
    if (marker === 0xda) {
      output.push(input.subarray(markerStart))
      offset = input.length
      break
    }
    if (STANDALONE_MARKERS.has(marker)) {
      output.push(input.subarray(markerStart, offset))
      if (marker === 0xd9) break
      continue
    }
    if (offset + 2 > input.length) throw new Error('Truncated JPEG segment length')
    const length = input.readUInt16BE(offset)
    if (length < 2) throw new Error(`Invalid JPEG segment length at byte ${offset}`)
    const segmentEnd = offset + length
    if (segmentEnd > input.length) throw new Error('JPEG segment extends past the input')
    if (METADATA_MARKERS.has(marker)) removedSegments += 1
    else output.push(input.subarray(markerStart, segmentEnd))
    offset = segmentEnd
  }

  if (offset !== input.length) throw new Error('JPEG parsing did not reach the end of the input')
  return { data: Buffer.concat(output), removedSegments }
}

export async function stripJpegMetadataFile(inputPath, outputPath) {
  const input = resolve(inputPath)
  const output = resolve(outputPath)
  if (input === output) throw new Error('Refusing to overwrite the input before validation')
  const inputData = await readFile(input)
  const result = stripJpegMetadata(inputData)
  await writeFile(output, result.data, { flag: 'wx' })
  return { input, output, inputBytes: inputData.length, outputBytes: result.data.length, removedSegments: result.removedSegments }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : ''
if (invokedPath === fileURLToPath(import.meta.url)) {
  const [, , inputPath, outputPath] = process.argv
  if (!inputPath || !outputPath) {
    process.stderr.write('Usage: node scripts/strip-jpeg-metadata.mjs INPUT.jpg OUTPUT.jpg\n')
    process.exitCode = 2
  } else {
    stripJpegMetadataFile(inputPath, outputPath)
      .then((result) => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`))
      .catch((error) => {
        process.stderr.write(`${error?.stack || error}\n`)
        process.exitCode = 1
      })
  }
}
