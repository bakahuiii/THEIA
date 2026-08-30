export class SyncDisabledError extends Error {
  constructor(message = 'Campus sync is disabled') {
    super(message)
    this.name = 'SyncDisabledError'
    this.code = 'sync_disabled'
  }
}

export class SyncCancelledError extends Error {
  constructor(message = 'Campus sync was cancelled') {
    super(message)
    this.name = 'SyncCancelledError'
    this.code = 'sync_cancelled'
  }
}
