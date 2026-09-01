function errorMessage(error) {
  return error instanceof Error ? error.message : String(error ?? "同步失败");
}

export function sanitizeSyncFailure(error) {
  return errorMessage(error)
    .replace(/https?:\/\/[^\s"'<>]+/gi, (value) => {
      try {
        const url = new URL(value);
        url.username = "";
        url.password = "";
        url.search = "";
        url.hash = "";
        return url.toString();
      } catch {
        return "[redacted-url]";
      }
    })
    .replace(/(?<![a-z0-9+.-])[a-z]:[\\/][^\r\n"']+/gi, "[local-path]")
    .replace(/\\\\[^\s"']+/g, "[local-path]")
    .replace(/\b(proxy-)?authorization\s*[:=]\s*(?:Bearer|Basic)\s+[A-Za-z0-9._~+\/-]+=*/gi, "$1authorization=[redacted]")
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+\/-]+=*/gi, "$1 [redacted]")
    .replace(/\b(set-cookie|cookie)\s*[:=]\s*[^\r\n]+/gi, "$1=[redacted]")
    .replace(/\b(password|passcode|token|api[_-]?key|secret|session(?:id)?|jsessionid)\s*[=:]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, "$1=[redacted]")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 720) || "同步失败";
}

function failureSignature(error) {
  return sanitizeSyncFailure(error).toLocaleLowerCase();
}

export function isRateLimitFailure(error) {
  const text = error instanceof Error ? `${error.message} ${error.code || ""}` : String(error ?? "");
  return /(?:访问|请求|操作)(?:过于|太过|过度)?频繁|请不要频繁|稍后再试|rate[-_ ]?limit|\b429\b|eratlimit/i.test(text);
}

const SYNC_RENDERER_START_GRACE_MS = 5_000;

export function syncStartedDuringRenderer(sync, rendererStartedAt, graceMs = SYNC_RENDERER_START_GRACE_MS) {
  const startedAt = Date.parse(sync?.lastStartedAt || "");
  const sessionStartedAt = Number(rendererStartedAt);
  if (!Number.isFinite(startedAt) || !Number.isFinite(sessionStartedAt)) return false;
  return startedAt >= sessionStartedAt - Math.max(0, Number(graceMs) || 0);
}

export function createSyncFailureObserver({ report, recover = () => {} }) {
  let initialized = false;
  let pending = [];
  let activeFailureSignature = null;
  let reportedRunId = null;
  let lastSuccessAt = null;
  let lastRunAt = null;
  let currentRunId = null;
  let pendingThrownSignature = null;

  const reportFailure = (error, runId = null) => {
    const signature = failureSignature(error);
    const effectiveRunId = runId || currentRunId;
    const sameRun = effectiveRunId && effectiveRunId === reportedRunId;
    const pendingThrown = effectiveRunId && !reportedRunId && signature === activeFailureSignature;
    const sameUnscopedFailure = !effectiveRunId && signature === activeFailureSignature;
    if (sameRun || pendingThrown || sameUnscopedFailure) {
      return false;
    }
    activeFailureSignature = signature;
    reportedRunId = effectiveRunId;
    report(sanitizeSyncFailure(error), { runId: effectiveRunId, signature });
    return true;
  };

  const observe = (snapshot) => {
    if (!initialized) {
      pending.push(snapshot);
      return;
    }
    const sync = snapshot?.sync || {};
    const runId = sync.runId || null;
    const incomingSignature = sync.lastError ? failureSignature(sync.lastError) : null;
    if (runId && runId !== currentRunId) {
      const matchesPendingThrown = Boolean(pendingThrownSignature && incomingSignature === pendingThrownSignature);
      currentRunId = runId;
      if (matchesPendingThrown) {
        pendingThrownSignature = null;
      } else {
        pendingThrownSignature = null;
        activeFailureSignature = null;
        reportedRunId = null;
      }
    }
    if (sync.lastSuccessAt && sync.lastSuccessAt !== lastSuccessAt) {
      activeFailureSignature = null;
      reportedRunId = null;
      recover({ lastSuccessAt: sync.lastSuccessAt });
    }
    lastSuccessAt = sync.lastSuccessAt || lastSuccessAt;
    const completedRunAt = sync.lastRunAt || sync.lastCompletedAt || null;
    if (!sync.lastError || !completedRunAt || completedRunAt === lastRunAt) return;
    lastRunAt = completedRunAt;

    reportFailure(sync.lastError, runId);
  };

  return {
    beginAttempt() {
      currentRunId = null;
      pendingThrownSignature = null;
      activeFailureSignature = null;
      reportedRunId = null;
    },
    initialize(snapshot) {
      if (initialized) return observe(snapshot);
      initialized = true;
      const sync = snapshot?.sync || {};
      lastSuccessAt = sync.lastSuccessAt || null;
      lastRunAt = sync.lastRunAt || sync.lastCompletedAt || null;
      currentRunId = sync.runId || null;
      pendingThrownSignature = null;
      activeFailureSignature = sync.lastError ? failureSignature(sync.lastError) : null;
      reportedRunId = sync.lastError ? sync.runId || null : null;
      const queued = pending;
      pending = [];
      for (const queuedSnapshot of queued) observe(queuedSnapshot);
    },
    observe,
    reportThrown(error) {
      const reported = reportFailure(error);
      if (reported && !currentRunId) pendingThrownSignature = failureSignature(error);
      return reported;
    },
  };
}

/**
 * @param {{ lastSuccessAt?: string | null, lastError?: string | null } | null | undefined} sync
 * @param {{
 *   syncing?: boolean,
 *   runtimeError?: string | null,
 *   now?: number,
 *   formatTime?: (value: string) => string,
 * }} [options]
 * @returns {{ kind: "syncing" | "failed" | "idle" | "ready", label: string, detail: string }}
 */
export function describeSyncFreshness(sync, {
  syncing = false,
  runtimeError = null,
  now = Date.now(),
  formatTime = (value) => value,
} = {}) {
  const lastSuccessAt = sync?.lastSuccessAt || null;
  if (syncing) {
    return {
      kind: "syncing",
      label: "同步中",
      detail: lastSuccessAt
        ? `当前显示上次成功于 ${formatTime(lastSuccessAt)}的数据`
        : "当前显示本机已有数据",
    };
  }
  if (sync?.lastError || runtimeError) {
    return {
      kind: "failed",
      label: "更新失败",
      detail: lastSuccessAt
        ? `更新失败，正在显示上次成功于 ${formatTime(lastSuccessAt)}的数据`
        : "更新失败，正在显示本机已有数据",
    };
  }
  if (!lastSuccessAt) {
    return { kind: "idle", label: "尚未同步", detail: "当前显示本机已有数据" };
  }
  const timestamp = new Date(lastSuccessAt).getTime();
  const justUpdated = Number.isFinite(timestamp) && Math.abs(now - timestamp) < 60_000;
  return {
    kind: "ready",
    label: justUpdated ? "刚更新" : `更新于 ${formatTime(lastSuccessAt)}`,
    detail: `上次成功同步于 ${formatTime(lastSuccessAt)}`,
  };
}
