import test from 'node:test'
import assert from 'node:assert/strict'
import {
  advisorConfidenceLabel,
  advisorDomainLabel,
  advisorRequirementSourceLabel,
  hideAdvisorItem,
  isAdvisorAgendaEmptyConfirmed,
  isCurrentAdvisorScenarioResponse,
  isAdvisorItemHidden,
  visibleAdvisorItems,
} from '../src/hooks/advisor-presentation.mjs'

function domainQuality(overrides = {}) {
  return {
    availability: 'empty-confirmed',
    freshness: 'fresh',
    completeness: 'complete',
    provenanceInferred: false,
    lastAttempt: {
      status: 'succeeded',
      retainedPrevious: false,
    },
    ...overrides,
  }
}

function agendaDataQuality(overrides = {}) {
  const confirmed = domainQuality()
  return {
    domains: {
      'academic-progress': structuredClone(confirmed),
      'academic-calendar': structuredClone(confirmed),
      assignments: structuredClone(confirmed),
      exams: structuredClone(confirmed),
      grades: structuredClone(confirmed),
      ...overrides,
    },
  }
}

function item(overrides = {}) {
  return {
    id: 'action-1',
    severity: 'attention',
    score: { components: { urgency: '24-72h' } },
    ...overrides,
  }
}

test('advisor dismiss is session-only and returns after a snapshot revision', () => {
  const current = item()
  const hidden = hideAdvisorItem(new Set(), 'revision-1', current, 'dismiss')
  assert.equal(isAdvisorItemHidden(hidden, 'revision-1', current), true)
  assert.equal(isAdvisorItemHidden(hidden, 'revision-2', current), false)
})

test('advisor snooze returns when the deterministic urgency band changes', () => {
  const current = item()
  const hidden = hideAdvisorItem(new Set(), 'revision-1', current, 'snooze')
  assert.equal(isAdvisorItemHidden(hidden, 'revision-1', current), true)
  assert.equal(isAdvisorItemHidden(hidden, 'revision-1', item({ score: { components: { urgency: '6-24h' } } })), false)
})

test('urgent actions cannot be dismissed but can be snoozed and restored', () => {
  const urgent = item({ severity: 'urgent' })
  const dismissed = hideAdvisorItem(new Set(), 'revision-1', urgent, 'dismiss')
  assert.equal(isAdvisorItemHidden(dismissed, 'revision-1', urgent), false)
  const snoozed = hideAdvisorItem(dismissed, 'revision-1', urgent, 'snooze')
  assert.deepEqual(visibleAdvisorItems([urgent], snoozed, 'revision-1', 7), [])
  assert.deepEqual(visibleAdvisorItems([urgent], new Set(), 'revision-1', 7), [urgent])
})

test('advisor labels never present inferred requirement trees as official', () => {
  assert.equal(advisorRequirementSourceLabel('roots', 'api-inferred-tree'), '推断树结构')
  assert.equal(advisorRequirementSourceLabel('roots', 'jwglxt-inferred-tree'), '推断树结构')
  assert.equal(advisorRequirementSourceLabel('roots', 'api-tree-detail'), '教务 API 树结构')
  assert.equal(advisorRequirementSourceLabel('roots', 'jwglxt-dom-tree'), '官方页面树结构')
  assert.equal(advisorRequirementSourceLabel('categories', null), '扁平列表回退')
  assert.equal(advisorRequirementSourceLabel('roots', null), '树结构（来源未确认）')
})

test('advisor domain and confidence labels are Chinese', () => {
  assert.equal(advisorDomainLabel('academic-progress'), '学业进度')
  assert.equal(advisorConfidenceLabel('high'), '高')
  assert.equal(advisorConfidenceLabel('medium'), '中')
  assert.equal(advisorConfidenceLabel('low'), '低')
  assert.equal(advisorConfidenceLabel('unknown'), '未知')
})

test('what-if responses are accepted only for their requested snapshot revision', () => {
  assert.equal(isCurrentAdvisorScenarioResponse({ snapshotRevision: 'revision-1' }, 'revision-1'), true)
  assert.equal(isCurrentAdvisorScenarioResponse({ snapshotRevision: 'revision-2' }, 'revision-1'), false)
  assert.equal(isCurrentAdvisorScenarioResponse(null, 'revision-1'), false)
})

test('agenda empty confirmation ignores unrelated unknown domains', () => {
  const quality = agendaDataQuality({
    mailbox: domainQuality({
      availability: 'unknown',
      freshness: 'unknown',
      completeness: 'unknown',
      lastAttempt: { status: 'never', retainedPrevious: false },
    }),
    fitness: domainQuality({ availability: 'absent' }),
  })
  assert.equal(isAdvisorAgendaEmptyConfirmed(quality), true)
})

for (const [name, override] of [
  ['missing', undefined],
  ['stale', domainQuality({ freshness: 'stale' })],
  ['partial', domainQuality({ completeness: 'partial' })],
  ['failed-retained', domainQuality({
    lastAttempt: { status: 'failed', retainedPrevious: true },
  })],
  ['legacy-inferred', domainQuality({ provenanceInferred: true })],
]) {
  test(`agenda empty confirmation rejects ${name} relevant data`, () => {
    const quality = agendaDataQuality()
    if (override === undefined) delete quality.domains.assignments
    else quality.domains.assignments = override
    assert.equal(isAdvisorAgendaEmptyConfirmed(quality), false)
  })
}
