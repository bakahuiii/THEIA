import { createAdvisorOverview } from '../core/advisor/index.mjs'

export const ADVISOR_TIME_ZONE = 'Asia/Shanghai'

export function advisorOverviewFromStore(store, { clock = () => new Date().toISOString() } = {}) {
  if (!store || typeof store.snapshotWithRevision !== 'function') {
    throw new TypeError('Advisor overview requires a versioned CampusStore snapshot')
  }
  if (typeof clock !== 'function') throw new TypeError('Advisor overview clock must be a function')

  const versionedSnapshot = store.snapshotWithRevision()
  const now = clock()
  return createAdvisorOverview(versionedSnapshot, {
    now,
    timeZone: ADVISOR_TIME_ZONE,
  })
}
