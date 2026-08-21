import { demoState } from "./demo";
import { resolveRuntimeBridge } from "./bridge-runtime.mjs";
import type {
  AcademicApiCredentialStatus,
  MailCredentialStatus,
  SavedSecretKind,
  ActivityLogEntry,
  AuthStatus,
  FitnessScoreResult,
  MotionVenueCatalog,
  MotionVenueStatus,
  TheiaBridge,
  CampusState,
  AdvisorOverview,
  UserDataDomainSummary,
  UserDataOverview,
  UserDataRecordsOptions,
  UserDataRecordsPage,
} from "./types";
import {
  projectBrowserRendererSnapshot,
  projectBrowserUserDataDomainSummary,
  projectBrowserUserDataOverview,
  projectBrowserUserDataRecords,
} from "./user-data-view";

const listeners = new Set<(state: CampusState) => void>();
let webState = structuredClone(demoState);
const demo = new URLSearchParams(window.location.search).get("demo") === "1";

const blankState: CampusState = {
  ...structuredClone(demoState),
  profile: null,
  courses: [],
  schedule: [],
  exams: [],
  grades: [],
  selectedCourses: [],
  academicProgress: null,
  assignments: [],
  notices: [],
  workspaces: [],
  sync: {
    lastStartedAt: null,
    lastCompletedAt: null,
    lastRunAt: null,
    lastSuccessAt: null,
    lastError: null,
    runId: null,
    sources: {},
    domains: {},
  },
};

if (!demo) webState = blankState;

function demoMotionCatalog(): MotionVenueCatalog {
  const source = webState.dataCatalog.collections.venueReservations;
  return {
    source: source.source,
    parserVersion: source.parserVersion,
    lastRefreshedAt: source.lastRefreshedAt,
    campuses: structuredClone(source.campuses),
    venues: structuredClone(source.venues),
  };
}

function motionDemoStatusKey(detailUrl: string, date: string, venue: string) {
  return [detailUrl, date, venue].map((value) => encodeURIComponent(value)).join("|");
}

function publishWebSnapshot() {
  const snapshot = structuredClone(webState);
  listeners.forEach((listener) => listener(snapshot));
}

function demoMotionStatus(query: { detailUrl?: string | null; date?: string | null; venue?: string | null }): MotionVenueStatus | null {
  const detailUrl = String(query.detailUrl || "").trim();
  if (!detailUrl) return null;
  const source = webState.dataCatalog.collections.venueReservations;
  const records = Object.values(source.statuses);
  const exact = records.find((record) => (
    record.scope.detailUrl === detailUrl
    && (!query.date || record.scope.date === query.date)
    && (!query.venue || record.scope.venue === query.venue)
  ));
  const base = exact || records.find((record) => record.scope.detailUrl === detailUrl);
  if (!base) return null;

  const selectedVenue = source.venues.find((item) => item.detailUrl === detailUrl && (!query.venue || item.label === query.venue));
  const result = structuredClone(base.result);
  result.capturedAt = new Date().toISOString();
  result.query = {
    ...result.query,
    detailUrl,
    date: String(query.date || result.query.date),
    venue: String(query.venue || result.query.venue),
    campus: selectedVenue
      ? { id: selectedVenue.campusId, label: selectedVenue.campusLabel }
      : result.query.campus,
    activity: selectedVenue?.activity || result.query.activity,
    availableDates: [...result.query.availableDates],
    availableVenues: [...result.query.availableVenues],
  };
  return result;
}

function cacheDemoMotionStatus(result: MotionVenueStatus) {
  const capturedAt = result.capturedAt || new Date().toISOString();
  const source = webState.dataCatalog.collections.venueReservations;
  const key = motionDemoStatusKey(result.query.detailUrl, result.query.date, result.query.venue);
  source.statuses[key] = {
    id: `motion-status:${key}`,
    scope: { detailUrl: result.query.detailUrl, date: result.query.date, venue: result.query.venue },
    capturedAt,
    source: source.source,
    parserVersion: source.parserVersion,
    result: structuredClone(result),
  };
  source.lastRefreshedAt = capturedAt;
  webState.dataCatalog.updatedAt = capturedAt;
  webState.updatedAt = capturedAt;
  publishWebSnapshot();
}

const webBridge: TheiaBridge = {
  async getSnapshot() {
    return structuredClone(webState);
  },
  async getRendererSnapshot() {
    return structuredClone(projectBrowserRendererSnapshot(webState));
  },
  async getUserDataOverview(): Promise<UserDataOverview> {
    return projectBrowserUserDataOverview(webState);
  },
  async getUserDataDomainSummary(domain: string): Promise<UserDataDomainSummary | null> {
    return projectBrowserUserDataDomainSummary(webState, domain);
  },
  async getUserDataRecords(domain: string, options?: UserDataRecordsOptions): Promise<UserDataRecordsPage> {
    const page = projectBrowserUserDataRecords(webState, domain, options);
    if (!page) throw new Error("资料域不存在");
    return page;
  },
  async getAdvisorOverview(): Promise<AdvisorOverview> {
    throw new Error("顾问概览仅在桌面客户端中可用");
  },
  async getAdvisorAcademicWhatIf() {
    throw new Error("顾问情景计算仅在桌面客户端中可用");
  },
  async getAdvisorCourseDecisions() {
    throw new Error("顾问选课分析仅在桌面客户端中可用");
  },
  async executeAdvisorAction() {
    throw new Error("顾问动作仅在桌面客户端中可用");
  },
  async listAdvisorThreads() {
    return [];
  },
  async createAdvisorThread() {
    throw new Error("模型顾问仅在桌面客户端中可用");
  },
  async prepareAdvisorRequest() {
    throw new Error("模型顾问仅在桌面客户端中可用");
  },
  async sendAdvisorRequest() {
    throw new Error("模型顾问仅在桌面客户端中可用");
  },
  async cancelAdvisorRequest() {
    return { cancelled: false, requestId: null };
  },
  async deleteAdvisorThread(threadId: string) {
    return { deleted: false, threadId };
  },
  onAdvisorStream() {
    return () => undefined;
  },
  async getActivityLog(): Promise<ActivityLogEntry[]> {
    return [];
  },
  async getAuthStatus() {
    const connected = demo;
    return { jwglxt: { connected }, theol: { connected } };
  },
  async getCredentialStatus() {
    return { saved: false, encryptionAvailable: false };
  },
  async getAcademicApiCredentialStatus(): Promise<AcademicApiCredentialStatus> {
    return { saved: false, encryptionAvailable: false, enabled: false };
  },
  async getMailCredentialStatus(): Promise<MailCredentialStatus> {
    return { saved: false, encryptionAvailable: false };
  },
  async readSavedSecret(kind: SavedSecretKind): Promise<string | null> {
    void kind;
    throw new Error("已保存密码仅可在桌面客户端中查看");
  },
  async saveCredentials() {
    throw new Error("账号安全存储仅在桌面客户端中可用");
  },
  async saveAcademicApiCredentials() {
    throw new Error("教务 API 账号配置仅在桌面客户端中可用");
  },
  async clearCredentials() {
    throw new Error("账号安全存储仅在桌面客户端中可用");
  },
  async clearAcademicApiCredentials(): Promise<AcademicApiCredentialStatus> {
    throw new Error("教务 API 账号配置仅在桌面客户端中可用");
  },
  async saveMailCredentials() {
    throw new Error("校园邮箱仅在桌面客户端中可用");
  },
  async clearMailCredentials(): Promise<MailCredentialStatus> {
    throw new Error("校园邮箱仅在桌面客户端中可用");
  },
  async refreshMailbox() {
    throw new Error("校园邮箱仅在桌面客户端中可用");
  },
  async openMailbox() {
    throw new Error("校园邮箱仅在桌面客户端中可用");
  },
  async readMailboxMessage() {
    throw new Error("校园邮箱仅在桌面客户端中可用");
  },
  async downloadMailboxAttachment() {
    throw new Error("校园邮箱仅在桌面客户端中可用");
  },
  async login() {
    throw new Error("统一身份认证仅在桌面客户端中可用");
  },
  async logout() {
    throw new Error("统一身份认证仅在桌面客户端中可用");
  },
  async syncNow() {
    throw new Error("校园数据同步仅在桌面客户端中可用");
  },
  async retrySyncDomain() {
    throw new Error("单项数据获取仅在桌面客户端中可用");
  },
  async queryFreeClassrooms() {
    throw new Error("空闲教室查询仅在桌面客户端中可用");
  },
  async getCourseSelection() {
    return { active: null, updatedAt: new Date().toISOString() };
  },
  async discoverCourseSelection() {
    throw new Error("Course selection is available only in the desktop client");
  },
  async getCourseSelectionCandidates() {
    throw new Error("Course selection is available only in the desktop client");
  },
  async searchSchoolSchedule() {
    throw new Error("School-wide schedule search is available only in the desktop client");
  },
  async getCachedSchoolSchedule() {
    return null;
  },
  async getMotionVenueCatalog() {
    return demoMotionCatalog();
  },
  async refreshMotionVenueCatalog() {
    if (!demo) throw new Error("MOTION 场馆目录仅在桌面客户端中可用");
    const capturedAt = new Date().toISOString();
    webState.dataCatalog.collections.venueReservations.lastRefreshedAt = capturedAt;
    webState.dataCatalog.updatedAt = capturedAt;
    webState.updatedAt = capturedAt;
    publishWebSnapshot();
    return demoMotionCatalog();
  },
  async queryMotionVenueStatus(query) {
    if (!demo) throw new Error("MOTION 场馆状态查询仅在桌面客户端中可用");
    const result = demoMotionStatus(query || {});
    if (!result) throw new Error("演示数据中没有对应的 MOTION 场馆状态");
    cacheDemoMotionStatus(result);
    return structuredClone(result);
  },
  async saveCourseSelectionTarget() {
    throw new Error("Course selection is available only in the desktop client");
  },
  async removeCourseSelectionTarget() {
    throw new Error("Course selection is available only in the desktop client");
  },
  async setCourseSelectionSentinel() {
    throw new Error("Course selection is available only in the desktop client");
  },
  async startCourseSelection() {
    throw new Error("Course selection is available only in the desktop client");
  },
  async stopCourseSelection() {
    throw new Error("Course selection is available only in the desktop client");
  },
  async getAcademicCalendarAssets() {
    throw new Error("Academic calendar assets are available only in the desktop client");
  },
  async refreshAcademicCalendarAssets() {
    throw new Error("Academic calendar assets are available only in the desktop client");
  },
  async openSource(url) {
    window.open(url, "_blank", "noopener,noreferrer");
    return true;
  },
  async openAcademicAttachment() {
    return { cached: false };
  },
  async openAssignmentSource() {
    throw new Error("Assignment source pages are available only in the desktop client");
  },
  async openSchedulePdf() {
    throw new Error(
      "Schedule PDF output is available only in the desktop client",
    );
  },
  async getCourseWorkQueue() {
    return { schema: "theia-course-work-queue/v1", enabled: false, updatedAt: new Date().toISOString(), jobs: [] };
  },
  async setCourseWorkQueueEnabled() {
    throw new Error("课程任务后台队列仅在桌面客户端中可用");
  },
  async enqueueCourseWork() {
    throw new Error("课程任务后台队列仅在桌面客户端中可用");
  },
  async cancelCourseWorkJob() {
    throw new Error("课程任务后台队列仅在桌面客户端中可用");
  },
  async prepareCourseWork() {
    throw new Error("课程工作包仅在桌面客户端中可用");
  },
  async openCourseWork() {
    throw new Error("课程工作包仅在桌面客户端中可用");
  },
  async importCourseWorkFile() {
    throw new Error("课程工作包仅在桌面客户端中可用");
  },
  async openSubmission() {
    throw new Error("作业提交仅在桌面客户端中可用");
  },
  async applyTestAnswers() {
    throw new Error("在线测试回填仅在桌面客户端中可用");
  },
  async exportData() {
    throw new Error("文件导出仅在桌面客户端中可用");
  },
  async openDataDirectory() {
    throw new Error("本地数据目录仅在桌面客户端中可用");
  },
  async getModelStatus() {
    return {
      configured: false,
      baseUrl: "",
      model: "",
      apiKeySaved: false,
      encryptionAvailable: false,
    };
  },
  async saveModelConfig() {
    throw new Error(
      "Model configuration is available only in the desktop client",
    );
  },
  async clearModelApiKey() {
    throw new Error("Model configuration is available only in the desktop client");
  },
  async cancelModelRequests() {
    return { cancelled: 0 };
  },
  async validateModelConnection() {
    throw new Error(
      "Model connection checks are available only in the desktop client",
    );
  },
  async discoverModels() {
    throw new Error("Model discovery is available only in the desktop client");
  },
  async processCourseWorkWithModel() {
    throw new Error(
      "Model task processing is available only in the desktop client",
    );
  },
  async renderAnswerPdf() {
    throw new Error("PDF 渲染仅在桌面客户端中可用");
  },
  async openAnswerPdf() {
    throw new Error("PDF 打开仅在桌面客户端中可用");
  },
  async summarizeNotices() {
    throw new Error("通知摘要仅在桌面客户端中可用");
  },
  async generateNotes() {
    throw new Error("笔记生成仅在桌面客户端中可用");
  },
  async generatePaper() {
    throw new Error("论文生成仅在桌面客户端中可用");
  },
  async renderMdFile() {
    throw new Error("PDF 渲染仅在桌面客户端中可用");
  },
  async getApiStatus() {
    return { baseUrl: "", host: "", port: 0, academicCalendarAssets: {}, academicPlanAssetBaseUrl: "" };
  },
  async getFitnessScore(): Promise<FitnessScoreResult> {
    throw new Error("体测成绩导入仅在桌面客户端中可用");
  },
  async updateSettings(settings) {
    void settings;
    throw new Error("应用设置仅在桌面客户端中可用");
  },
  async installMcpClients() {
    throw new Error("MCP 配置仅在桌面客户端中可用");
  },
  async chooseAppBackground() {
    return new Promise((resolve) => {
      const picker = document.createElement("input");
      picker.type = "file";
      picker.accept = "image/png,image/jpeg,image/webp,image/gif,image/avif";
      let settled = false;
      const finish = (result: {
        canceled: boolean;
        url?: string;
        name?: string;
      }) => {
        if (settled) return;
        settled = true;
        resolve(result);
      };
      picker.addEventListener("change", () => {
        const file = picker.files?.[0];
        if (!file) return finish({ canceled: true });
        finish({
          canceled: false,
          url: URL.createObjectURL(file),
          name: file.name,
        });
      });
      picker.addEventListener("cancel", () => finish({ canceled: true }));
      picker.click();
    });
  },
  async getAppearancePresets() {
    return { exists: false, updatedAt: null, presets: [] };
  },
  async saveAppearancePresets(presets) {
    return { updatedAt: new Date().toISOString(), presets };
  },
  onSyncProgress() {
    return () => undefined;
  },
  onSnapshot(callback) {
    listeners.add(callback);
    return () => listeners.delete(callback);
  },
  onAuthStatus() {
    return () => undefined;
  },
  onCourseSelection() {
    return () => undefined;
  },
  onCourseWorkQueue() {
    return () => undefined;
  },
  onNewMail() {
    return () => undefined;
  },
};

export const bridge: TheiaBridge = resolveRuntimeBridge({
  protocol: window.location.protocol,
  nativeBridge: window.theia,
  webBridge,
});
export const isDesktop = Boolean(window.theia);

export function disconnectedStatus(): AuthStatus {
  return {
    jwglxt: { connected: false, unchecked: true },
    theol: { connected: false, unchecked: true },
  };
}
