import { randomUUID } from 'node:crypto'

/**
 * Owns the lifecycle bookkeeping for source-scoped authentication actors.
 * BrowserWindow and campus-specific parsing stay in the caller; this module
 * only coordinates epochs, single-flight actors, cancellation, and ordering.
 */
export function createAuthActorManager({
  sources,
  getEpoch,
  isExplicitlyLoggedOut = () => false,
  run,
  finish = async () => {},
  onFailure = () => {},
  createActor = (source, options) => ({ source, ...options }),
} = {}) {
  const allowedSources = new Set(Array.isArray(sources) ? sources : [])
  const actors = new Map()
  const pendingSources = new Set()
  let lifecycleQueue = Promise.resolve()

  if (typeof getEpoch !== 'function') throw new TypeError('auth actor manager requires getEpoch')
  if (typeof run !== 'function') throw new TypeError('auth actor manager requires run')

  const isCurrent = (actor, window = actor?.window) => Boolean(
    actor
    && !actor.invalidated
    && actor.epoch === getEpoch()
    && actors.get(actor.source) === actor
    && (!window || (actor.window === window && !window.isDestroyed?.())),
  )

  const removePending = (source) => {
    pendingSources.delete(source)
  }

  const removePendingSourceOpens = (source, pendingSourceOpens = []) => {
    for (let index = pendingSourceOpens.length - 1; index >= 0; index -= 1) {
      if (pendingSourceOpens[index]?.source === source) pendingSourceOpens.splice(index, 1)
    }
  }

  const create = (source, options = {}) => {
    if (!allowedSources.has(source)) throw new Error(`unsupported authentication source: ${source}`)
    const current = actors.get(source)
    if (current && !current.invalidated && current.epoch === getEpoch()) return current

    let resolveOpened
    let rejectOpened
    let resolveClosed
    const opened = new Promise((resolve, reject) => {
      resolveOpened = resolve
      rejectOpened = reject
    })
    const closed = new Promise((resolve) => { resolveClosed = resolve })
    // Invalidation intentionally rejects `opened` so callers do not continue
    // with a window that was cancelled by logout. Keep a handler attached for
    // actors created by background recovery where nobody awaits that promise.
    void opened.catch(() => undefined)
    const actor = createActor(source, {
      ...options,
      id: randomUUID(),
      epoch: getEpoch(),
      window: null,
      windows: new Set(),
      invalidated: false,
      authenticated: false,
      opened,
      closed,
      resolveOpened,
      rejectOpened,
      resolveClosed,
      lifecycle: null,
    })
    actors.set(source, actor)
    pendingSources.add(source)

    const lifecycle = lifecycleQueue
      .catch(() => {})
      .then(() => run(actor))
    lifecycleQueue = lifecycle.catch(() => {})
    actor.lifecycle = lifecycle
      .catch((error) => {
        actor.rejectOpened?.(error)
        actor.resolveOpened?.()
        actor.resolveClosed?.()
        onFailure(error, actor)
      })
      .finally(async () => {
        removePending(source)
        if (actors.get(source) === actor) actors.delete(source)
        await finish(actor)
      })
    // Callers often await lifecycle indirectly after invalidation. Avoid an
    // unhandled rejection when the original run failed before they attached.
    void actor.lifecycle.catch(() => undefined)
    return actor
  }

  const get = (source) => actors.get(source) || null
  const values = () => [...actors.values()]

  const invalidate = (actor, { reason = 'cancelled', pendingSourceOpens } = {}) => {
    if (!actor || actor.invalidated) return false
    actor.invalidated = true
    actor.invalidatedReason = reason
    actor.rejectOpened?.(new Error(reason))
    actor.resolveOpened?.()
    if ((!actor.window || actor.window.isDestroyed?.()) && !actor.windows?.size) actor.resolveClosed?.()
    removePending(actor.source)
    removePendingSourceOpens(actor.source, pendingSourceOpens)
    return true
  }

  const invalidateAll = (options = {}) => {
    const current = values()
    actors.clear()
    for (const actor of current) invalidate(actor, options)
    pendingSources.clear()
    return current
  }

  const clear = () => {
    actors.clear()
    pendingSources.clear()
  }

  const open = async ({ background = false, requestedSources, expectedEpoch = getEpoch(), userInitiated = false, requireBrowser = false, skipSync = false } = {}) => {
    if (expectedEpoch !== getEpoch() || (!userInitiated && isExplicitlyLoggedOut())) {
      const error = new Error('学校平台操作已因显式退出取消')
      error.code = 'AUTH_EPOCH_CHANGED'
      throw error
    }
    const selected = Array.isArray(requestedSources) && requestedSources.length
      ? [...new Set(requestedSources.filter((source) => allowedSources.has(source)))]
      : [...allowedSources].filter((source) => source !== 'tygl')
    const actorList = selected.map((source) => {
      const current = get(source)
      if (current && !current.invalidated && current.epoch === getEpoch()) {
        if (requireBrowser) current.requireBrowser = true
        if (skipSync) current.skipSync = true
        if (!background && current.window && !current.window.isDestroyed?.()) {
          current.window.show?.()
          current.window.focus?.()
        }
        return current
      }
      if (requireBrowser || skipSync) return create(source, { background, userInitiated, requireBrowser, skipSync })
      return create(source, { background, userInitiated })
    })
    await Promise.all(actorList.map((actor) => actor.opened))
    if (expectedEpoch !== getEpoch() || (!userInitiated && isExplicitlyLoggedOut())) {
      const error = new Error('学校平台操作已因显式退出取消')
      error.code = 'AUTH_EPOCH_CHANGED'
      throw error
    }
    return actorList
  }

  return Object.freeze({
    actors,
    pendingSources,
    get,
    values,
    create,
    open,
    isCurrent,
    invalidate,
    invalidateAll,
    clear,
    removePendingSourceOpens,
    get queue() { return lifecycleQueue },
    isEmpty: () => actors.size === 0,
  })
}
