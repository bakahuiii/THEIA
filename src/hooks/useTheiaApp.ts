import { useCallback, useEffect, useMemo, useState } from "react";
import { bridge, disconnectedStatus, isDesktop } from "../bridge";
import { createLatestApiStatusLoader } from "./runtime-api-status.mjs";
import {
  createSyncFailureObserver,
  describeSyncFreshness,
  sanitizeSyncFailure,
} from "./sync-status.mjs";
import { navItems } from "../ui/navigation";
import { relativeTime, type ViewId } from "../ui/app-shared";
import type {
  AcademicApiCredentialStatus,
  ActivityLogEntry,
  AuthStatus,
  CampusState,
  CourseSelectionCatalogPage,
  CourseSelectionCandidate,
  CourseSelectionPortal,
  CourseSelectionSnapshot,
  CourseSelectionTarget,
  CourseSelectionSentinel,
  SchoolScheduleItem,
  SchoolScheduleQuery,
  SchoolScheduleResult,
  CredentialStatus,
  ModelStatus,
  MailCredentialStatus,
} from "../types";

type SyncFreshness = {
  kind: "syncing" | "failed" | "idle" | "ready";
  label: string;
  detail: string;
};

const emptyModelStatus: ModelStatus = {
  configured: false,
  baseUrl: "",
  model: "",
  apiKeySaved: false,
  encryptionAvailable: false,
};

const SIDEBAR_COLLAPSED_STORAGE_KEY = "theia-sidebar-collapsed-v1";

function readSidebarCollapsed() {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

export function useTheiaApp() {
  const [state, setState] = useState<CampusState | null>(null);
  const [auth, setAuth] = useState<AuthStatus>(disconnectedStatus());
  const [view, setView] = useState<ViewId>("dashboard");
  const [syncing, setSyncing] = useState(false);
  const [exportingSchedulePdf, setExportingSchedulePdf] = useState(false);
  const [syncProgress, setSyncProgress] = useState<string | null>(null);
  const [syncStage, setSyncStage] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsedState] = useState(
    readSidebarCollapsed,
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [messageKind, setMessageKind] = useState<"info" | "error" | "success">(
    "info",
  );
  const [startupError, setStartupError] = useState<string | null>(null);
  const [syncFailure, setSyncFailure] = useState<string | null>(null);
  const [runtimeSyncError, setRuntimeSyncError] = useState<string | null>(null);
  const [freshnessNow, setFreshnessNow] = useState(() => Date.now());

  const setMsg = useCallback((
    text: string | null,
    kind: "info" | "error" | "success" = "info",
  ) => {
    setMessage(text);
    setMessageKind(text ? kind : "info");
  }, []);
  const setError = useCallback((error: unknown) =>
    setMsg(
      error instanceof Error ? error.message : String(error),
      "error",
    ), [setMsg]);
  const showDataError = useCallback((error: unknown) => {
    const text = sanitizeSyncFailure(error);
    setMsg(text, "error");
    setSyncFailure(text);
    setRuntimeSyncError(text);
  }, [setMsg]);
  const syncFailureObserver = useMemo(() => createSyncFailureObserver({
    report: (error: string) => showDataError(error),
    recover: () => {
      setSyncFailure(null);
      setRuntimeSyncError(null);
    },
  }), [showDataError]);
  const [apiBase, setApiBase] = useState("");
  const [calendarAssetUrls, setCalendarAssetUrls] = useState<
    Partial<Record<"calendar" | "teachingSchedule" | "weeklyCalendar", string>>
  >({});
  const [credentialStatus, setCredentialStatus] =
    useState<CredentialStatus | null>(null);
  const [academicApiCredentialStatus, setAcademicApiCredentialStatus] =
    useState<AcademicApiCredentialStatus | null>(null);
  const [mailCredentialStatus, setMailCredentialStatus] =
    useState<MailCredentialStatus | null>(null);
  const [credentialDismissed, setCredentialDismissed] = useState(false);
  const [workingAssignmentId, setWorkingAssignmentId] = useState<string | null>(
    null,
  );
  const [modelStatus, setModelStatus] = useState<ModelStatus>(emptyModelStatus);
  const [courseSelection, setCourseSelection] =
    useState<CourseSelectionSnapshot>({
      active: null,
      updatedAt: new Date().toISOString(),
    });
  const [courseSelectionPortal, setCourseSelectionPortal] =
    useState<CourseSelectionPortal | null>(null);
  const [courseSelectionCandidates, setCourseSelectionCandidates] = useState<
    CourseSelectionCandidate[]
  >([]);
  const [courseSelectionCatalogPage, setCourseSelectionCatalogPage] =
    useState<CourseSelectionCatalogPage>({ page: 1, pageSize: 24, total: 0 });
  const [courseSelectionLoading, setCourseSelectionLoading] = useState(false);
  const [schoolSchedule, setSchoolSchedule] = useState<SchoolScheduleResult | null>(null);
  const [schoolScheduleLoading, setSchoolScheduleLoading] = useState(false);
  const [schoolScheduleError, setSchoolScheduleError] = useState<string | null>(null);
  const [schoolScheduleRefreshFailed, setSchoolScheduleRefreshFailed] = useState(false);
  const [activityLog, setActivityLog] = useState<ActivityLogEntry[]>([]);
  const [activityLoading, setActivityLoading] = useState(false);

  const refreshActivityLog = useCallback(async () => {
    setActivityLoading(true);
    try {
      setActivityLog(await bridge.getActivityLog());
    } catch (error) {
      setError(error);
    } finally {
      setActivityLoading(false);
    }
  }, [setError]);

  useEffect(() => {
    const suppressAltMenu = (event: KeyboardEvent) => {
      if (event.key === "Alt") event.preventDefault();
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteQuery("");
        setPaletteOpen(true);
      }
      if (event.key === "Escape") setPaletteOpen(false);
    };
    window.addEventListener("keydown", suppressAltMenu, true);
    return () => window.removeEventListener("keydown", suppressAltMenu, true);
  }, []);

  useEffect(() => {
    const refreshNow = () => setFreshnessNow(Date.now());
    const interval = window.setInterval(refreshNow, 30_000);
    window.addEventListener("focus", refreshNow);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshNow);
    };
  }, []);

  useEffect(() => {
    let active = true;
    let firstPaintFrame: number | null = null;
    let runtimeStatusFrame: number | null = null;
    const loadApiStatus = createLatestApiStatusLoader({
      load: () => bridge.getApiStatus(),
      apply: (api: Awaited<ReturnType<typeof bridge.getApiStatus>>) => {
        if (active) {
          setApiBase(api.baseUrl);
          setCalendarAssetUrls(api.academicCalendarAssets || {});
        }
      },
    });
    void bridge
      .getSnapshot()
      .then((snapshot) => {
        if (!active) return;
        syncFailureObserver.initialize(snapshot);
        setState(snapshot);
        // Keep cached data loading silent so the first usable frame stays calm.
        // Connection probes run only after authoritative local data is loaded.
        firstPaintFrame = window.requestAnimationFrame(() => {
          runtimeStatusFrame = window.requestAnimationFrame(() => {
            if (active) loadRuntimeStatus();
          });
        });
      })
      .catch((error) => {
        if (!active) return;
        syncFailureObserver.initialize(null);
        const text = `无法读取本地校园数据：${sanitizeSyncFailure(error)}`;
        setStartupError(text);
        setError(text);
        window.dispatchEvent(new Event("theia:initialization-complete"));
      });
    const loadRuntimeStatus = () => {
      void Promise.all([
      bridge.getAuthStatus(),
      loadApiStatus(),
      bridge.getCredentialStatus(),
      bridge.getAcademicApiCredentialStatus(),
      bridge.getMailCredentialStatus(),
      bridge.getModelStatus(),
      bridge.getCourseSelection(),
      bridge.getCachedSchoolSchedule(),
    ])
      .then(
        ([
          status,
          ,
          credentials,
          academicApiCredentials,
          mailCredentials,
          model,
          selection,
          cachedSchoolSchedule,
        ]) => {
          if (!active) return;
          setAuth(status);
          setCredentialStatus(credentials);
          setAcademicApiCredentialStatus(academicApiCredentials);
          setMailCredentialStatus(mailCredentials);
          setModelStatus(model);
          setCourseSelection(selection);
          setSchoolSchedule(cachedSchoolSchedule);
        },
      )
      .catch((error) => {
        if (active)
          setError(error);
      })
      .finally(() => {
        if (active) window.dispatchEvent(new Event("theia:initialization-complete"));
      });
    };
    const offSnapshot = bridge.onSnapshot((snapshot) => {
      syncFailureObserver.observe(snapshot);
      setState(snapshot);
      void loadApiStatus().catch(() => undefined);
    });
    const offAuth = bridge.onAuthStatus((status) => setAuth(status));
    const offCourseSelection = bridge.onCourseSelection((selection) =>
      setCourseSelection(selection),
    );
    const offNewMail = bridge.onNewMail((mail) => {
      setMsg(`新邮件 · ${mail.subject || "(无主题)"}`, "info");
    });
    const offProgress = bridge.onSyncProgress((progress) => {
      if (progress.scope === "domain") return;
      if (progress.stage === "all" && progress.status === "syncing") {
        syncFailureObserver.beginAttempt();
        setSyncFailure(null);
        setRuntimeSyncError(null);
        setSyncing(true);
        setSyncStage("all");
        setSyncProgress(progress.label || "正在更新校园数据…");
        return;
      }
      if (progress.status === "syncing") {
        setSyncFailure(null);
        setRuntimeSyncError(null);
      }
      if (progress.stage === "all") {
        if (progress.status === "error" && progress.error) {
          syncFailureObserver.reportThrown(progress.error);
        } else if (progress.status === "done") {
          setSyncFailure(null);
          setRuntimeSyncError(null);
        }
        setSyncing(false);
        setSyncStage(null);
        setSyncProgress(
          progress.status === "error" ? "校园数据更新失败" : "校园数据更新完成",
        );
        return;
      }
      if (progress.status === "syncing") setSyncing(true);
      setSyncStage(progress.stage || null);
      const labels: Record<string, string> = {
        jwglxt: "教务系统",
        theol: "北化在线THEOL",
        schedule: "课表",
        "academic-progress": "学业进度",
        grades: "成绩",
        exams: "考试",
        "selected-courses": "已选课程",
        notices: "通知",
      };
      if (progress.label) setSyncProgress(progress.label);
      else if (progress.status === "syncing")
        setSyncProgress(`正在同步${labels[progress.stage] || progress.stage}…`);
      else if (progress.status === "done")
        setSyncProgress(`${labels[progress.stage] || progress.stage}同步完成`);
      else if (progress.status === "error")
        setSyncProgress(`${labels[progress.stage] || progress.stage}失败`);
    });
    return () => {
      active = false;
      if (firstPaintFrame !== null) cancelAnimationFrame(firstPaintFrame);
      if (runtimeStatusFrame !== null)
        cancelAnimationFrame(runtimeStatusFrame);
      offSnapshot();
      offAuth();
      offCourseSelection();
      offNewMail();
      offProgress();
    };
  }, [setError, setMsg, syncFailureObserver]);

  useEffect(() => {
    if (settingsOpen) void refreshActivityLog();
  }, [refreshActivityLog, settingsOpen]);
  useEffect(() => {
    if (!message) return;
    const timeout = window.setTimeout(() => setMessage(null), 6_000);
    return () => window.clearTimeout(timeout);
  }, [message]);

  const credentials = credentialStatus || {
    saved: false,
    encryptionAvailable: false,
  };
  const hasSession = Boolean(
    auth.jwglxt.connected ||
    auth.theol.connected ||
    (state?.settings.academicApiEnabled && academicApiCredentialStatus?.saved),
  );
  const requestLogin = async () => {
    if (isDesktop && !credentials.saved) {
      setCredentialDismissed(false);
      return;
    }
    await bridge.login();
  };
  const sync = async () => {
    if (!hasSession) {
      try {
        await requestLogin();
        if (credentials.saved) setMsg("正在恢复学校统一身份认证会话");
      } catch (error) {
        showDataError(error);
      }
      return;
    }
    syncFailureObserver.beginAttempt();
    setSyncing(true);
    setMsg(null);
    setSyncFailure(null);
    setRuntimeSyncError(null);
    try {
      const snapshot = await bridge.syncNow();
      syncFailureObserver.observe(snapshot);
      setState(snapshot);
      if (!snapshot.sync.lastError) {
        setSyncFailure(null);
        setRuntimeSyncError(null);
      }
    } catch (error) {
      syncFailureObserver.reportThrown(error);
    } finally {
      setSyncing(false);
    }
  };
  const exportSchedulePdf = async () => {
    setExportingSchedulePdf(true);
    try {
      const result = await bridge.openSchedulePdf();
      if (!result.canceled)
        setMsg(`课表 PDF 已保存：${result.filePath || "文档/THEIA/课表"}`, "success");
    } catch (error) {
      setError(error);
    } finally {
      setExportingSchedulePdf(false);
    }
  };
  const runCourseWork = async (
    assignmentId: string,
    operation: () => Promise<CampusState>,
    success: string,
  ) => {
    setWorkingAssignmentId(assignmentId);
    try {
      setState(await operation());
      setMsg(success, "success");
    } catch (error) {
      setError(error);
    } finally {
      setWorkingAssignmentId(null);
    }
  };
  const prepareCourseWork = (assignmentId: string) =>
    void runCourseWork(
      assignmentId,
      () => bridge.prepareCourseWork(assignmentId),
      "工作包已准备：题干、附件和测试题目已保存到本地工作区",
    );
  const processCourseWorkWithModel = (assignmentId: string) =>
    void runCourseWork(
      assignmentId,
      () => bridge.processCourseWorkWithModel(assignmentId),
      "模型结果已保存到本地工作区；在线测试答案可写入内置浏览器页面，最终提交仍需你确认",
    );
  const generateNotes = (assignmentId: string) =>
    void runCourseWork(
      assignmentId,
      () => bridge.generateNotes(assignmentId),
      "课程笔记已生成，可点击「笔记→PDF」渲染后保存",
    );
  const generatePaper = (assignmentId: string) =>
    void runCourseWork(
      assignmentId,
      () => bridge.generatePaper(assignmentId),
      "论文草稿已生成，可点击「论文→PDF」渲染后提交",
    );
  const renderMdFile = (assignmentId: string, fileKey: string) =>
    void runCourseWork(
      assignmentId,
      async () => (await bridge.renderMdFile(assignmentId, fileKey)).snapshot,
      "PDF 渲染完成",
    );
  const openAnswerPdf = async (assignmentId: string) => {
    try {
      await bridge.openAnswerPdf(assignmentId);
    } catch (error) {
      setError(error);
    }
  };
  const openCourseWork = async (assignmentId: string) => {
    try {
      await bridge.openCourseWork(assignmentId);
    } catch (error) {
      setError(error);
    }
  };
  const openAssignmentSource = async (assignmentId: string) => {
    try {
      await bridge.openAssignmentSource(assignmentId);
    } catch (error) {
      setError(error);
    }
  };
  const importCourseWorkFile = async (
    assignmentId: string,
    kind: "answer" | "answer-key",
  ) => {
    setWorkingAssignmentId(assignmentId);
    try {
      const result = await bridge.importCourseWorkFile(assignmentId, kind);
      if (!result.canceled) {
        setState(result.snapshot);
        setMsg(
          kind === "answer-key"
            ? "测试答案 JSON 已导入，可写入内置浏览器中的测试页面"
            : "提交文件已保存到本地工作区",
          "success",
        );
      }
    } catch (error) {
      setError(error);
    } finally {
      setWorkingAssignmentId(null);
    }
  };
  const openSubmission = async (assignmentId: string) => {
    setWorkingAssignmentId(assignmentId);
    try {
      const result = await bridge.openSubmission(assignmentId);
      if (!result.canceled) {
        setState(result.snapshot);
        setMsg(result.message || "已打开北化在线THEOL提交页", "success");
      }
    } catch (error) {
      setError(error);
    } finally {
      setWorkingAssignmentId(null);
    }
  };
  const applyTestAnswers = async (assignmentId: string) => {
    setWorkingAssignmentId(assignmentId);
    try {
      const result = await bridge.applyTestAnswers(assignmentId);
      setState(result.snapshot);
      setMsg(
        result.failed.length
          ? `已写入 ${result.applied.length}/${result.total} 题；${result.failed.length} 题未匹配，请在测试页核对`
          : `已写入 ${result.applied.length} 题，请在内置浏览器中核对后提交`,
        "success",
      );
    } catch (error) {
      setError(error);
    } finally {
      setWorkingAssignmentId(null);
    }
  };
  const discoverCourseSelection = async () => {
    setCourseSelectionLoading(true);
    try {
      const portal = await bridge.discoverCourseSelection();
      setCourseSelectionPortal(portal);
      setCourseSelectionCandidates([]);
      if (!portal.available)
        setMsg(portal.message || "当前没有开放的选课批次", "info");
    } catch (error) {
      setError(error);
    } finally {
      setCourseSelectionLoading(false);
    }
  };
  const loadCourseSelectionCandidates = async (
    blockId: string,
    target: Pick<SchoolScheduleItem, "courseCode" | "title"> | null = null,
    options: Partial<CourseSelectionCatalogPage> = {},
  ) => {
    setCourseSelectionLoading(true);
    try {
      const result = await bridge.getCourseSelectionCandidates(blockId, target, options);
      setCourseSelectionPortal(result.portal);
      setCourseSelectionCandidates(result.candidates);
      setCourseSelectionCatalogPage({
        page: result.page,
        pageSize: result.pageSize,
        total: result.total,
      });
      if (!result.candidates.length) setMsg("该选课模块暂未返回可选教学班", "info");
    } catch (error) {
      setError(error);
    } finally {
      setCourseSelectionLoading(false);
    }
  };
  const searchSchoolSchedule = async (query: SchoolScheduleQuery) => {
    setSchoolScheduleLoading(true);
    setSchoolScheduleError(null);
    setSchoolScheduleRefreshFailed(false);
    try {
      setSchoolSchedule(await bridge.searchSchoolSchedule(query));
    } catch (error) {
      const text = sanitizeSyncFailure(error);
      setSchoolScheduleError(text);
      setSchoolScheduleRefreshFailed(Boolean(schoolSchedule));
    } finally {
      setSchoolScheduleLoading(false);
    }
  };
  const saveCourseSelectionTarget = async (target: SchoolScheduleItem | null) => {
    if (!target) return;
    try {
      setCourseSelection(await bridge.saveCourseSelectionTarget(target));
    } catch (error) {
      setError(error);
    }
  };
  const removeCourseSelectionTarget = async (id: string) => {
    if (typeof bridge.removeCourseSelectionTarget !== "function") {
      setMsg("暂时无法移除目标，请重启 THEIA 后重试。", "info");
      return;
    }
    try {
      setCourseSelection(await bridge.removeCourseSelectionTarget(id));
    } catch (error) {
      setError(error);
    }
  };
  const setCourseSelectionSentinel = async (config: Partial<CourseSelectionSentinel>) => {
    setCourseSelectionLoading(true);
    try {
      setCourseSelection(await bridge.setCourseSelectionSentinel(config));
      setMsg(config.enabled ? "抢课哨兵已开启。" : "抢课哨兵已停止。", "success");
    } catch (error) {
      setError(error);
    } finally {
      setCourseSelectionLoading(false);
    }
  };
  const startCourseSelection = async (options: {
    candidate?: CourseSelectionCandidate | null;
    targets?: CourseSelectionTarget[];
    startAt: string | null;
    endAt?: string | null;
    intervalMs: number;
    maxAttempts: number;
    concurrency?: number;
    sentinel?: boolean;
  }) => {
    setCourseSelectionLoading(true);
    try {
      setCourseSelection(await bridge.startCourseSelection(options));
      setMsg(
        "抢课任务已创建。任务会按设定的并发数执行，可随时停止。",
        "success",
      );
    } catch (error) {
      setError(error);
    } finally {
      setCourseSelectionLoading(false);
    }
  };
  const stopCourseSelection = async () => {
    try {
      setCourseSelection(await bridge.stopCourseSelection());
    } catch (error) {
      setError(error);
    }
  };

  const visibleTerms = useMemo(() => {
    const terms = state?.terms || [];
    const startYear = Number(
      String(state?.profile?.studentId || "").slice(0, 4),
    );
    return !Number.isFinite(startYear) || startYear < 1900
      ? terms
      : terms.filter((term) => Number(term.id.split("-")[0]) >= startYear);
  }, [state]);
  const syncPercent = syncing
    ? {
        jwglxt: 24,
        schedule: 42,
        grades: 58,
        exams: 68,
        "academic-progress": 76,
        "selected-courses": 82,
        theol: 88,
        notices: 94,
      }[syncStage || ""] || 18
    : 100;
  const syncFreshness = useMemo<SyncFreshness>(() => describeSyncFreshness(state?.sync, {
    syncing,
    runtimeError: runtimeSyncError,
    now: freshnessNow,
    formatTime: (value: string) => relativeTime(value, freshnessNow),
  }) as SyncFreshness, [freshnessNow, runtimeSyncError, state?.sync, syncing]);
  const paletteItems = navItems.filter(({ label }) =>
    label.toLowerCase().includes(paletteQuery.trim().toLowerCase()),
  );
  const navigate = useCallback((nextView: ViewId) => {
    if (nextView === "settings") {
      setSettingsOpen(true);
      return;
    }
    setView(nextView);
  }, []);
  const setSidebarCollapsed = useCallback((collapsed: boolean) => {
    setSidebarCollapsedState(collapsed);
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, String(collapsed));
    } catch {
      // Layout remains usable when persistent storage is unavailable.
    }
  }, []);

  return {
    state,
    auth,
    view,
    syncing,
    exportingSchedulePdf,
    syncProgress,
    query,
    sidebarOpen,
    sidebarCollapsed,
    settingsOpen,
    paletteOpen,
    paletteQuery,
    message,
    messageKind,
    startupError,
    syncFailure,
    syncFreshness,
    apiBase,
    calendarAssetUrls,
    credentialStatus,
    academicApiCredentialStatus,
    mailCredentialStatus,
    credentialDismissed,
    workingAssignmentId,
    modelStatus,
    courseSelection,
    courseSelectionPortal,
    courseSelectionCandidates,
    courseSelectionCatalogPage,
    courseSelectionLoading,
    activityLog,
    activityLoading,
    credentials,
    hasSession,
    syncPercent,
    paletteItems,
    visibleTerms,
    setAuth,
    setView: navigate,
    setQuery,
    setSidebarOpen,
    setSidebarCollapsed,
    setSettingsOpen,
    setPaletteOpen,
    setPaletteQuery,
    setMessage: setMsg,
    dismissSyncFailure: () => setSyncFailure(null),
    setCredentialStatus,
    setAcademicApiCredentialStatus,
    setMailCredentialStatus,
    setCredentialDismissed,
    setModelStatus,
    refreshActivityLog,
    requestLogin,
    sync,
    exportSchedulePdf,
    prepareCourseWork,
    processCourseWorkWithModel,
    generateNotes,
    generatePaper,
    renderMdFile,
    openAnswerPdf,
    openCourseWork,
    openAssignmentSource,
    importCourseWorkFile,
    openSubmission,
    applyTestAnswers,
    discoverCourseSelection,
    loadCourseSelectionCandidates,
    schoolSchedule,
    schoolScheduleLoading,
    schoolScheduleError,
    schoolScheduleRefreshFailed,
    dismissSchoolScheduleError: () => setSchoolScheduleError(null),
    searchSchoolSchedule,
    saveCourseSelectionTarget,
    removeCourseSelectionTarget,
    setCourseSelectionSentinel,
    startCourseSelection,
    stopCourseSelection,
  };
}
