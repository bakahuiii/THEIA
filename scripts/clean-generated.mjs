import { lstat, readdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const fixedGeneratedPaths = [
  'dist',
  'release-bin',
  '.vite',
  'coverage',
  'test-results',
  '.eslintcache',
  'tsconfig.app.tsbuildinfo',
  'tsconfig.node.tsbuildinfo',
]

const rootEntries = await readdir(workspaceRoot, { withFileTypes: true })
const temporaryPaths = rootEntries
  .filter((entry) => entry.name.startsWith('.tmp-'))
  .map((entry) => entry.name)

const candidatePaths = [...fixedGeneratedPaths, ...temporaryPaths]
const pathsToRemove = []

for (const relativePath of candidatePaths) {
  const targetPath = path.resolve(workspaceRoot, relativePath)
  if (targetPath !== workspaceRoot && !targetPath.startsWith(`${workspaceRoot}${path.sep}`)) {
    throw new Error(`Refusing to clean path outside workspace: ${relativePath}`)
  }
  try {
    await lstat(targetPath)
    pathsToRemove.push({ relativePath, targetPath })
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
}

for (const { targetPath } of pathsToRemove) {
  await rm(targetPath, { recursive: true, force: true })
}

if (pathsToRemove.length === 0) {
  console.log('No generated workspace output found.')
} else {
  console.log(`Removed ${pathsToRemove.length} generated workspace path(s).`)
}
