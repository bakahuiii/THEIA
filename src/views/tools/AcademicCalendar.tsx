import { useCallback, useEffect, useState } from "react";
import {
  CalendarDays,
  FileText,
  Image,
  LoaderCircle,
  Maximize2,
  RefreshCw,
} from "lucide-react";
import { bridge, isDesktop } from "../../bridge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "../../components/ui/dialog";
import type { AcademicCalendarAssetsSnapshot, LocalDataCatalog } from "../../types";
import { formatDateTime } from "../../ui/app-shared";

type AssetKey = "calendar" | "teachingSchedule" | "weeklyCalendar";
type Preview = { title: string; url: string; kind: "image" | "pdf" };

const ASSETS: Array<{ key: AssetKey; title: string; detail: string; icon: typeof Image }> = [
  { key: "calendar", title: "校历", detail: "高清校历图", icon: Image },
  { key: "teachingSchedule", title: "教学进程表", detail: "本学年教学安排", icon: FileText },
  { key: "weeklyCalendar", title: "周历", detail: "逐周教学进程", icon: CalendarDays },
];

function formatTime(value?: string | null) {
  return value ? formatDateTime(value) : "尚未获取";
}

export function AcademicCalendar({
  dataCatalog,
  apiBase,
  assetUrls,
}: {
  dataCatalog: LocalDataCatalog;
  apiBase: string;
  assetUrls?: Partial<Record<AssetKey, string>>;
}) {
  const [manifest, setManifest] = useState<AcademicCalendarAssetsSnapshot | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);

  const catalog = dataCatalog.collections.academicCalendar;
  const assets = manifest?.assets || catalog?.assets || {};
  const calendar = manifest?.calendar || catalog?.calendar || null;
  // A loaded manifest is authoritative, including a successful null error.
  // Do not resurrect a stale catalog error after OCR has recovered.
  const calendarError = manifest ? manifest.calendarError : catalog?.calendarError || null;
  const refreshedAt = manifest?.updatedAt || catalog?.lastRefreshedAt || null;
  const assetUrl = useCallback(
    (key: AssetKey) =>
      assetUrls?.[key] || (apiBase
        ? `${apiBase}/v1/academic-calendar/${
            key === "calendar"
              ? "calendar"
              : key === "teachingSchedule"
                ? "teaching-schedule"
                : "weekly-calendar"
          }`
        : ""),
    [apiBase, assetUrls],
  );

  const loaded = ASSETS.some(({ key }) => Boolean(assets[key]?.filename));
  const loadManifest = useCallback(async () => {
    if (!isDesktop) return;
    setManifest(await bridge.getAcademicCalendarAssets());
  }, []);

  useEffect(() => {
    void loadManifest().catch(() => undefined);
  }, [loadManifest]);

  async function refresh() {
    setRefreshing(true);
    setError(null);
    try {
      setManifest(await bridge.refreshAcademicCalendarAssets({ force: true }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "校历更新失败");
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <section className="academic-calendar" aria-label="校历">
      <header className="academic-calendar-header">
        <div>
          <span className="academic-calendar-kicker">教务处本地档案</span>
          <h2>校历与教学进程</h2>
          <p>启动时自动检查，资源仅保存在 THEIA 本地数据目录。</p>
        </div>
        <button
          type="button"
          className="academic-calendar-refresh"
          onClick={() => void refresh()}
          disabled={!isDesktop || refreshing}
        >
          {refreshing ? <LoaderCircle size={15} /> : <RefreshCw size={15} />}
          <span>{refreshing ? "正在更新" : "立即更新"}</span>
        </button>
      </header>

      <div className="academic-calendar-status">
        <span className={loaded ? "ready" : "pending"}>
          {loaded ? "本地文件已就绪" : "等待首次获取"}
        </span>
        <span>更新于 {formatTime(refreshedAt)}</span>
      </div>
      {error && <p className="academic-calendar-error">{error}</p>}
      {calendarError && (
        <p className="academic-calendar-error">
          校历已保存，但日期识别失败：{calendarError}
        </p>
      )}
      {calendar && (
        <div className="academic-calendar-dates">
          <div className="academic-calendar-year">
            <strong>{calendar.schoolYear}</strong>
            <span>学年</span>
          </div>
          {calendar.semesters.map((semester) => (
            <div className="academic-calendar-term" key={semester.startDate}>
              <strong>{semester.label}</strong>
              <span>
                {semester.startDate} 至 {semester.endDate} · {semester.weeks} 周
              </span>
            </div>
          ))}
          {calendar.currentWeek && (
            <div className="academic-calendar-current">
              <strong>第 {calendar.currentWeek.week} 周</strong>
              <span>{calendar.currentWeek.semesterLabel}</span>
            </div>
          )}
        </div>
      )}

      <div className="academic-calendar-grid">
        {ASSETS.map(({ key, title, detail, icon: Icon }) => {
          const entry = assets[key];
          const url = assetUrl(key);
          const ready = Boolean(entry?.filename && url);
          const isPdf = key !== "calendar";
          return (
            <article
              className={`academic-calendar-asset ${key === "calendar" ? "calendar-image" : ""} ${isPdf && ready ? "pdf-preview" : ""}`}
              key={key}
            >
              {key === "calendar" && ready ? (
                <img src={url} alt="北京化工大学校历" />
              ) : isPdf && ready ? (
                <iframe
                  className="academic-calendar-pdf-preview"
                  title={`${title}预览`}
                  src={`${url}#page=1&view=FitH&toolbar=0&navpanes=0`}
                />
              ) : (
                <Icon className="academic-calendar-icon" size={26} />
              )}
              <div className="academic-calendar-asset-copy">
                <strong>{title}</strong>
                <span>
                  {ready
                    ? `${detail} · ${(entry.bytes / 1024 / 1024).toFixed(1)} MB`
                    : "将在后台自动获取"}
                </span>
              </div>
              {ready && (
                <button
                  type="button"
                  className="academic-calendar-open"
                  aria-label={isPdf ? `阅读${title}` : `查看${title}大图`}
                  title={isPdf ? `阅读${title}` : `查看${title}大图`}
                  onClick={() => setPreview({ title, url, kind: isPdf ? "pdf" : "image" })}
                >
                  <Maximize2 size={16} />
                </button>
              )}
            </article>
          );
        })}
      </div>

      <Dialog
        open={Boolean(preview)}
        onOpenChange={(open) => {
          if (!open) setPreview(null);
        }}
      >
        {preview && (
          <DialogContent className={`academic-calendar-pdf-dialog ${preview.kind === "image" ? "academic-calendar-image-dialog" : ""}`}>
            <div className="academic-calendar-pdf-heading">
              <div className="academic-calendar-pdf-heading-icon">
                {preview.kind === "image" ? <Image size={18} /> : <FileText size={18} />}
              </div>
              <div>
                <DialogTitle>{preview.title}</DialogTitle>
                <DialogDescription>{preview.kind === "image" ? "校历资料 · 高清图片预览" : "校历资料 · 本地 PDF 阅读"}</DialogDescription>
              </div>
            </div>
            {preview.kind === "image" ? (
              <div className="academic-calendar-image-reader">
                <img src={preview.url} alt={`${preview.title}大图`} />
              </div>
            ) : (
              <iframe
                className="academic-calendar-pdf-reader"
                title={preview.title}
                src={`${preview.url}#toolbar=1&navpanes=0&view=FitH`}
              />
            )}
          </DialogContent>
        )}
      </Dialog>
    </section>
  );
}
