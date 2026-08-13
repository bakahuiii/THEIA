import { demoState } from "./demo";
import { resolveRuntimeBridge } from "./bridge-runtime.mjs";
import type {
  AcademicApiCredentialStatus,
  MailCredentialStatus,
  SavedSecretKind,
  ActivityLogEntry,
  AuthStatus,
  FitnessScoreResult,
  TheiaBridge,
  CampusState,
  AdvisorOverview,
} from "./types";

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

const webBridge: TheiaBridge = {
  async getSnapshot() {
    return structuredClone(webState);
  },
  async getAdvisorOverview(): Promise<AdvisorOverview> {
    throw new Error("Advisor overview is available only in the desktop client");
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
  async openAssignmentSource() {
    throw new Error("Assignment source pages are available only in the desktop client");
  },
  async openSchedulePdf() {
    throw new Error(
      "Schedule PDF output is available only in the desktop client",
    );
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
    return { baseUrl: "", host: "", port: 0, academicCalendarAssets: {} };
  },
  async getFitnessScore(): Promise<FitnessScoreResult> {
    throw new Error("体测成绩导入仅在桌面客户端中可用");
  },
  async updateSettings(settings) {
    void settings;
    throw new Error("应用设置仅在桌面客户端中可用");
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
  return { jwglxt: { connected: false }, theol: { connected: false } };
}
