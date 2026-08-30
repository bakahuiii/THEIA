import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [viewSource, catalogSource, summarySource, helperSource, hookSource] = await Promise.all([
  readFile(new URL('../src/views/CourseSelectionView.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/views/course-selection/CandidateCatalog.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/views/course-selection/DecisionSummary.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/views/course-selection/selection-helpers.ts', import.meta.url), 'utf8'),
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
  assert.match(viewSource, /from "\.\/course-selection\/selection-helpers"/)
  assert.match(helperSource, /function advisorCandidateRecord\(candidate: CourseSelectionCandidate\)/)
  for (const field of [
    'id', 'courseId', 'courseCode', 'title', 'credits',
    'categoryCode', 'blockTitle', 'termId', 'time',
  ]) assert.match(helperSource, new RegExp(`${field}: candidate\\.${field}`))
  assert.doesNotMatch(helperSource, /operationId|sourceUrl|classId/)
  assert.match(viewSource, /const advisorCandidateInput = useMemo\(/)
  assert.match(viewSource, /\(\) => candidates\.map\(advisorCandidateRecord\)/)
  assert.match(viewSource, /bridge\.getAdvisorCourseDecisions\(\{/)
  assert.match(viewSource, /snapshotRevision: advisorSnapshotRevision/)
  assert.match(catalogSource, /const advisorDecisionByCandidate = useMemo\(/)
  assert.match(catalogSource, /const rankedCandidates = useMemo\(/)
  assert.match(catalogSource, /left\.rank \?\? Number\.POSITIVE_INFINITY/)
  assert.match(catalogSource, /right\.rank \?\? Number\.POSITIVE_INFINITY/)
  assert.match(catalogSource, /left\.index - right\.index/)
})

test('advisor results sort candidates by stable rank and expose required decision evidence', () => {
  assert.match(catalogSource, /<th>本地顾问排名<\/th>/)
  assert.match(catalogSource, /DecisionSummary/)
  assert.match(summarySource, /decision\.rank/)
  assert.match(summarySource, /confidenceLabels\[match\.confidence\]/)
  assert.match(summarySource, /scheduleStatusLabels\[decision\.scheduleStatus\]/)
  assert.match(summarySource, /duplicateStatusLabels\[decision\.duplicateStatus\]/)
  assert.match(summarySource, /decision\.scheduleConflicts\.map/)
  assert.match(summarySource, /decision\.reasons\.map/)
  assert.match(summarySource, /数据部分完整|完整性未知/)
})

test('renderer delegates completeness to the one-snapshot main-process authority', () => {
  assert.doesNotMatch(viewSource, /bridge\.getAdvisorOverview\(\)/)
  assert.doesNotMatch(viewSource, /schoolScheduleComplete:/)
  assert.doesNotMatch(viewSource, /completeness:\s*\{/)
})

test('ranking evidence returned by the frozen service snapshot is reachable in the UI', () => {
  assert.match(summarySource, /查看排名理由/)
  assert.doesNotMatch(viewSource, /setAdvisorEvidence\(result\.evidence\)/)
  assert.doesNotMatch(viewSource, /decision\.evidenceRefs/)
  assert.doesNotMatch(viewSource, /EvidenceDrawer/)
})

test('ranking lifecycle is stale-safe and falls back to source order after failure', () => {
  assert.match(viewSource, /const requestId = \+\+advisorDecisionRequest\.current/)
  assert.match(viewSource, /advisorDecisionRequest\.current !== requestId/)
  assert.match(viewSource, /JSON\.stringify\(advisorCandidateInput\)/)
  assert.match(viewSource, /advisorDecisionInputKey === advisorCandidateInputKey/)
  assert.match(viewSource, /advisorDecisionRevision === advisorSnapshotRevision/)
  assert.match(viewSource, /result\.snapshotRevision !== advisorSnapshotRevision/)
  assert.match(viewSource, /setAdvisorDecisionError\(true\)/)
  assert.match(catalogSource, /left\.index - right\.index/)
  assert.match(catalogSource, /按原顺序显示/)
})

test('advisor ranking cannot save a target or start course selection', () => {
  const effect = sourceBetween(
    viewSource,
    'useEffect(() => {\n    const requestId = ++advisorDecisionRequest.current;',
    '  useEffect(() => {\n    if (!schoolTarget || !candidates.length) return;',
  )
  assert.doesNotMatch(effect, /onStart|startCourseSelection|onSaveSchoolTarget|saveSchoolTarget|selectCandidate/)
  assert.doesNotMatch(viewSource, /advisorDecisions?\.proposals|result\.proposals/)
  assert.doesNotMatch(viewSource, /bridge\.startCourseSelection/)
  assert.match(catalogSource, /onClick=\{\(\) => onSelectCandidate\(candidate\)\}/)
  assert.match(viewSource, /onClick=\{\(\) => onStart\(\{/)
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

test('school-wide targets retain lookup identity through the renderer boundary', () => {
  assert.match(viewSource, /target: SchoolScheduleItem \| null/)
  assert.match(viewSource, /courseId: target\.courseId \|\| target\.courseCode/)
  assert.match(viewSource, /categoryCode: target\.categoryCode/)
  assert.match(viewSource, /jxbzls: target\.jxbzls/)
  assert.match(viewSource, /selectionContext: target\.selectionContext/)
  assert.match(viewSource, /schoolTarget,\n      \{ page, pageSize \}/)
  assert.match(viewSource, /courseId: candidate\.courseId/)
  assert.match(hookSource, /target: SchoolScheduleItem \| null = null/)
})
