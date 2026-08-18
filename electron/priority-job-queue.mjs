/**
 * A small single-flight priority queue for browser-backed requests.
 *
 * Jobs with a larger priority run first. Jobs with the same priority retain
 * insertion order. The queue deliberately starts jobs in a microtask so a
 * synchronous throw from a job is handled like any other rejected job.
 */
export function createPriorityJobQueue() {
  let running = false
  let sequence = 0
  const pending = []

  const drain = () => {
    if (running || pending.length === 0) return
    pending.sort((left, right) => right.priority - left.priority || left.sequence - right.sequence)
    const job = pending.shift()
    running = true
    Promise.resolve()
      .then(job.fn)
      .then(
        (value) => {
          running = false
          drain()
          job.resolve(value)
        },
        (error) => {
          running = false
          drain()
          job.reject(error)
        },
      )
      .catch(() => {
        // Promise resolution callbacks are user supplied and should never
        // prevent the queue from processing later jobs.
      })
  }

  return {
    enqueue(fn, { priority = 0 } = {}) {
      if (typeof fn !== 'function') return Promise.reject(new TypeError('queue job must be a function'))
      return new Promise((resolve, reject) => {
        pending.push({
          fn,
          resolve,
          reject,
          priority: Number.isFinite(Number(priority)) ? Number(priority) : 0,
          sequence: sequence++,
        })
        drain()
      })
    },

    cancelPending(error = new Error('Queued request cancelled')) {
      const cancelled = pending.splice(0)
      for (const job of cancelled) job.reject(error)
      return cancelled.length
    },

    get pendingCount() {
      return pending.length
    },

    get running() {
      return running
    },
  }
}
