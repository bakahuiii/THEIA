import { computeDomainDigests } from '../../core/domain-provenance.mjs'

export const FIXED_NOW = '2026-08-13T00:00:00.000Z'
export const OLD_CAPTURE = '2026-08-10T00:00:00.000Z'
export const CURRENT_CAPTURE = '2026-08-12T23:00:00.000Z'

export function domainOutcome(overrides = {}) {
  return {
    runId: 'run-1',
    source: ['fixture'],
    attempted: true,
    succeeded: true,
    attemptedAt: CURRENT_CAPTURE,
    completedAt: CURRENT_CAPTURE,
    status: 'succeeded',
    capturedAt: CURRENT_CAPTURE,
    sourceSucceededAt: CURRENT_CAPTURE,
    emptyConfirmed: false,
    contentEmptyConfirmed: false,
    retainedPrevious: false,
    completeness: 'complete',
    parserVersion: 'fixture-parser/v1',
    errorCode: null,
    ...overrides,
  }
}

export function versionedState(overrides = {}, domainOutcomes = {}) {
  const state = {
    profile: null,
    terms: [],
    courses: [],
    schedule: [],
    exams: [],
    grades: [],
    selectedCourses: [],
    academicProgress: null,
    assignments: [],
    workspaces: [],
    notices: [],
    emails: [],
    dataCatalog: {},
    sync: {
      runId: 'run-1',
      lastStartedAt: CURRENT_CAPTURE,
      lastCompletedAt: CURRENT_CAPTURE,
      domains: domainOutcomes,
    },
    ...overrides,
  }
  return {
    state,
    revision: 'fixture-revision-1',
    committedAt: CURRENT_CAPTURE,
    domainDigests: computeDomainDigests(state),
  }
}
