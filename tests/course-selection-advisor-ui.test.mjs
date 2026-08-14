import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [source, hookSource] = await Promise.all([
  readFile(new URL('../src/views/CourseSelectionView.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/hooks/useTheiaApp.ts', import.meta.url), 'utf8'),
])

function sourceBetween(sourceText, startMarker, endMarker) {
  const start = sourceText.indexOf(startMarker)
  const end = sourceText.indexOf(endMarker, start + startMarker.length)
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`)
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`)
  return sourceText.slice(start, end)
}

test('candidate loading starts a local read-only advisor ranking with a safe projection', () => {
  assert.match(source, /import \{ bridge \} from "\.\.\/bridge"/)
  assert.match(source, /function advisorCandidateRecord\(candidate: CourseSelectionCandidate\)/)
  const projection = source.match(
    /function advisorCandidateRecord[\s\S]*?\n}\n\nfunction DecisionSummary/,
  )?.[0]
  assert.ok(projection, 'safe candidate projection must remain explicit')
  for (const field of [
    'id', 'courseId', 'courseCode', 'title', 'credits',
    'categoryCode', 'blockTitle', 'termId', 'time',
  ]) assert.match(projection, new RegExp(`${field}: candidate\\.${field}`))
  assert.doesNotMatch(projection, /operationId|sourceUrl|classId/)
  assert.match(source, /bridge\.getAdvisorCourseDecisions\(\{/)
  assert.match(source, /snapshotRevision: advisorSnapshotRevision/)
  assert.match(source, /const advisorCandidateInput = useMemo\(/)
  assert.match(source, /\(\) => candidates\.map\(advisorCandidateRecord\)/)
  assert.match(source, /candidates: advisorCandidateInput/)
})

test('advisor results sort candidates by stable rank and expose required decision evidence', () => {
  assert.match(source, /advisorDecisionByCandidate\.get\(candidate\.id\)\?\.rank/)
  assert.match(source, /left\.rank \?\? Number\.POSITIVE_INFINITY/)
  assert.match(source, /<th>本地顾问排名<\/th>/)
  assert.match(source, /decision\.rank/)
  assert.match(source, /confidenceLabels\[match\.confidence\]/)
  assert.match(source, /scheduleStatusLabels\[decision\.scheduleStatus\]/)
  assert.match(source, /duplicateStatusLabels\[decision\.duplicateStatus\]/)
  assert.match(source, /decision\.scheduleConflicts\.map/)
  assert.match(source, /decision\.reasons\.map/)
  assert.match(source, /数据部分完整|完整性未知/)
})

test('renderer delegates completeness to the one-snapshot main-process authority', () => {
  assert.doesNotMatch(source, /bridge\.getAdvisorOverview\(\)/)
  assert.doesNotMatch(source, /schoolScheduleComplete:/)
  assert.doesNotMatch(source, /completeness:\s*\{/)
})

test('ranking evidence returned by the frozen service snapshot is reachable in the UI', () => {
  assert.match(source, /setAdvisorEvidence\(result\.evidence\)/)
  assert.match(source, /decision\.evidenceRefs/)
  assert.match(source, /<EvidenceDrawer/)
  assert.match(source, /查看证据/)
})

test('ranking lifecycle is stale-safe and falls back to source order after failure', () => {
  assert.match(source, /const requestId = \+\+advisorDecisionRequest\.current/)
  assert.match(source, /advisorDecisionRequest\.current !== requestId/)
  assert.match(source, /JSON\.stringify\(advisorCandidateInput\)/)
  assert.match(source, /advisorDecisionInputKey === advisorCandidateInputKey/)
  assert.match(source, /advisorDecisionRevision === advisorSnapshotRevision/)
  assert.match(source, /result\.snapshotRevision !== advisorSnapshotRevision/)
  assert.match(source, /setAdvisorDecisionError\(true\)/)
  assert.match(source, /left\.index - right\.index/)
  assert.match(source, /按原顺序显示/)
})

test('advisor ranking cannot save a target or start course selection', () => {
  const effect = source.match(
    /useEffect\(\(\) => \{\n    const requestId = \+\+advisorDecisionRequest[\s\S]*?\n  }, \[advisorCandidateInput, advisorCandidateInputKey, advisorDecisionRetry, advisorSnapshotRevision, candidates\.length\]\);/,
  )?.[0]
  assert.ok(effect, 'ranking effect must remain a reviewable isolated block')
  assert.doesNotMatch(effect, /onStart|startCourseSelection|onSaveSchoolTarget|saveSchoolTarget|selectCandidate/)
  assert.doesNotMatch(source, /advisorDecisions?\.proposals|result\.proposals/)
  assert.doesNotMatch(source, /bridge\.startCourseSelection/)
  assert.match(source, /onClick=\{\(\) => selectCandidate\(candidate\)\}/)
  assert.match(source, /onClick=\{\(\) => onStart\(\{/)
})

test('candidate catalog accepts only the latest in-flight request', () => {
  const loader = sourceBetween(
    hookSource,
    'const loadCourseSelectionCandidates = async',
    'const searchSchoolSchedule = async',
  )

  assert.match(loader, /const requestSequence = \+\+courseSelectionCandidatesRequestSequence\.current/)
  assert.match(loader, /requestSequence !== courseSelectionCandidatesRequestSequence\.current/)
  assert.match(loader, /requestSequence === courseSelectionCandidatesRequestSequence\.current/)
  assert.match(loader, /setCourseSelectionPortal\(result\.portal\)/)
  assert.match(loader, /setCourseSelectionCandidates\(result\.candidates\)/)
  assert.match(loader, /setCourseSelectionCatalogPage\(\{/)
})
