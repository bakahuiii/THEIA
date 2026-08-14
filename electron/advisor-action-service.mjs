import { createAdvisorOverview } from '../core/advisor/index.mjs'
import { normalizeText, shortDigest } from '../core/advisor/canonical.mjs'

export const ADVISOR_ACTION_ERROR = Object.freeze({
  STALE_SNAPSHOT: 'stale-snapshot',
  ACTION_NOT_FOUND: 'action-not-found',
  ACTION_NOT_ALLOWED: 'action-not-allowed',
  TARGET_UNAVAILABLE: 'target-unavailable',
  RESOLUTION_FAILED: 'resolution-failed',
  EXECUTION_FAILED: 'execution-failed',
})

const ERROR_DETAILS = Object.freeze({
  [ADVISOR_ACTION_ERROR.STALE_SNAPSHOT]: { message: '顾问数据已更新，请重新计算后再执行。', retryable: true },
  [ADVISOR_ACTION_ERROR.ACTION_NOT_FOUND]: { message: '该顾问动作已失效，请重新计算后再执行。', retryable: true },
  [ADVISOR_ACTION_ERROR.ACTION_NOT_ALLOWED]: { message: '该顾问动作不允许由后台执行。', retryable: false },
  [ADVISOR_ACTION_ERROR.TARGET_UNAVAILABLE]: { message: '无法从当前快照唯一确认该作业来源，请重新同步后再试。', retryable: true },
  [ADVISOR_ACTION_ERROR.RESOLUTION_FAILED]: { message: '无法根据当前快照验证该顾问动作，请刷新顾问数据后重试。', retryable: true },
  [ADVISOR_ACTION_ERROR.EXECUTION_FAILED]: { message: '无法打开来源详情，请完成登录或刷新数据后重试。', retryable: true },
})

export function advisorActionFailure(code, actionId = null) {
  const detail = ERROR_DETAILS[code] || ERROR_DETAILS[ADVISOR_ACTION_ERROR.EXECUTION_FAILED]
  return Object.freeze({
    ok: false,
    ...(actionId ? { actionId } : {}),
    error: Object.freeze({ code, message: detail.message, retryable: detail.retryable }),
  })
}

function assignmentAdvisorEntityId(assignment) {
  const rawId = normalizeText(assignment?.id, { trim: true })
  return rawId ? `assignment:${shortDigest(rawId, 16)}` : null
}

function staleSnapshotError() {
  const error = new Error(ERROR_DETAILS[ADVISOR_ACTION_ERROR.STALE_SNAPSHOT].message)
  error.code = ADVISOR_ACTION_ERROR.STALE_SNAPSHOT
  return error
}

export function assertAdvisorSnapshotRevision(store, expectedRevision) {
  if (!store || typeof store.snapshotWithRevision !== 'function') {
    throw new TypeError('Advisor snapshot assertion requires a versioned CampusStore snapshot')
  }
  const snapshotRevision = normalizeText(expectedRevision, { trim: true })
  const versioned = store.snapshotWithRevision()
  if (!snapshotRevision || versioned.revision !== snapshotRevision) throw staleSnapshotError()
  return versioned
}

export function resolveAdvisorActionFromStore(store, request, {
  clock = () => new Date().toISOString(),
  timeZone = 'Asia/Shanghai',
  createOverview = createAdvisorOverview,
} = {}) {
  const actionId = normalizeText(request?.actionId, { trim: true })
  try {
    const snapshotRevision = normalizeText(request?.snapshotRevision, { trim: true })
    let versioned
    try {
      versioned = assertAdvisorSnapshotRevision(store, snapshotRevision)
    } catch (error) {
      if (error?.code === ADVISOR_ACTION_ERROR.STALE_SNAPSHOT) {
        return advisorActionFailure(ADVISOR_ACTION_ERROR.STALE_SNAPSHOT, actionId)
      }
      throw error
    }

    const overview = createOverview(versioned, { now: clock(), timeZone })
    const action = overview.urgentItems.find((item) => item.id === actionId)
    if (!action) return advisorActionFailure(ADVISOR_ACTION_ERROR.ACTION_NOT_FOUND, actionId)
    if (action.actionKind !== 'open-source-detail' || action.kind !== 'assignment' || action.domain !== 'assignments') {
      return advisorActionFailure(ADVISOR_ACTION_ERROR.ACTION_NOT_ALLOWED, actionId)
    }

    const state = versioned.state ?? versioned.snapshot
    const matches = (Array.isArray(state?.assignments) ? state.assignments : []).filter((assignment) => (
      assignment?.source === 'theol' && assignmentAdvisorEntityId(assignment) === action.entityId
    ))
    if (matches.length !== 1) return advisorActionFailure(ADVISOR_ACTION_ERROR.TARGET_UNAVAILABLE, actionId)

    return Object.freeze({
      ok: true,
      snapshotRevision,
      actionId,
      target: Object.freeze({
        kind: 'open-assignment-source',
        assignmentId: normalizeText(matches[0].id, { trim: true }),
      }),
    })
  } catch {
    return advisorActionFailure(ADVISOR_ACTION_ERROR.RESOLUTION_FAILED, actionId)
  }
}
