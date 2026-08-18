import { useEffect, useRef, useState } from "react";
import { ExternalLink, FileText, Maximize2, RefreshCw } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "../../components/ui/dialog";
import { formatDate, EmptyState } from "../../ui/app-shared";
import type { AcademicExtraDomain, CampusState } from "../../types";

type AcademicPlanViewProps = {
  state: CampusState;
  refreshing: boolean;
  onRefresh: () => void;
  onOpenSource: (url: string) => void;
  onOpenAttachment: (domain: string, attachmentId: string) => Promise<{ cached: boolean }>;
  assetBaseUrl?: string;
};

function planStatus(domain: AcademicExtraDomain | undefined, state: CampusState) {
  const provenance = state.sync.domains["academic-plan"];
  if (provenance?.status === "failed" || provenance?.status === "auth-required") return "failed";
  if (domain?.completeness === "partial" || provenance?.completeness === "partial") return "partial";
  if (domain?.capturedAt && domain.completeness === "complete") return "ready";
  return "pending";
}

function isPdfAttachment(attachment: AcademicExtraDomain["attachments"][number]) {
  return /pdf/iu.test(String(attachment.type || "")) || /\.pdf(?:$|[?#])/iu.test(String(attachment.sourceUrl || ""));
}

function formatBytes(value: number | null | undefined) {
  return typeof value === "number" && value > 0 ? `${(value / 1024 / 1024).toFixed(1)} MB` : "本地 PDF";
}

export function AcademicPlanView({ state, refreshing, onRefresh, onOpenSource, onOpenAttachment, assetBaseUrl = "" }: AcademicPlanViewProps) {
  const domain = state.academicExtras?.domains?.["academic-plan"];
  const status = planStatus(domain, state);
  const requested = useRef(false);
  const [openingAttachmentId, setOpeningAttachmentId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ title: string; url: string } | null>(null);

  useEffect(() => {
    if (!domain?.capturedAt && !refreshing && !requested.current) {
      requested.current = true;
      onRefresh();
    }
  }, [domain?.capturedAt, onRefresh, refreshing]);

  const pdfs = (domain?.attachments || []).filter(isPdfAttachment);
  const assetUrl = (attachment: AcademicExtraDomain["attachments"][number]) =>
    attachment.id && assetBaseUrl ? `${assetBaseUrl}${encodeURIComponent(attachment.id)}` : "";
  const openFallback = async (attachment: AcademicExtraDomain["attachments"][number]) => {
    if (!attachment.id || openingAttachmentId) return;
    setOpeningAttachmentId(attachment.id);
    setError(null);
    try {
      const result = await onOpenAttachment("academic-plan", attachment.id);
      if (!result.cached) setError("官方 PDF 尚未缓存成功，请重新读取后再试。");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "官方 PDF 打开失败");
    } finally {
      setOpeningAttachmentId(null);
    }
  };

  return (
    <div className="academic-records-view academic-plan-view">
      <header className="academic-records-header">
        <div>
          <span className="academic-records-kicker">JWGLXT · READ ONLY</span>
          <h2>培养计划</h2>
          <p>直接使用教务系统官方培养计划 PDF，不把不完整的页面索引当成培养方案。</p>
        </div>
        <button type="button" className="academic-records-refresh" onClick={onRefresh} disabled={refreshing}>
          <RefreshCw size={15} className={refreshing ? "spinning" : ""} aria-hidden="true" />
          {refreshing ? "读取中" : "重新读取"}
        </button>
      </header>

      <section className="academic-records-panel" aria-label="官方培养计划">
        <div className="academic-records-meta">
          <span className={`academic-records-status ${status}`}>{status === "ready" ? "已读取" : status === "partial" ? "部分读取" : status === "failed" ? "读取失败" : "未读取"}</span>
          <span>{domain?.capturedAt ? `最近读取 ${formatDate(domain.capturedAt)}` : "尚未读取"}</span>
          {domain?.sourceUrl && <button type="button" className="academic-records-source" onClick={() => onOpenSource(domain.sourceUrl || "")}><ExternalLink size={13} aria-hidden="true" />来源页面</button>}
        </div>
        {error && <p className="academic-plan-attachment-error" role="status">{error}</p>}
        {pdfs.length ? (
          <div className="academic-calendar-grid" aria-label="官方培养计划 PDF">
            {pdfs.map((attachment) => {
              const url = assetUrl(attachment);
              const title = attachment.label || attachment.filename || "官方培养计划 PDF";
              return (
                <article className={`academic-calendar-asset ${url ? "pdf-preview" : ""}`} key={attachment.id || attachment.sourceUrl}>
                  {url ? (
                    <iframe
                      className="academic-calendar-pdf-preview"
                      title={`${title}预览`}
                      src={`${url}#page=1&view=FitH&toolbar=0&navpanes=0`}
                    />
                  ) : (
                    <FileText className="academic-calendar-icon" size={26} />
                  )}
                  <div className="academic-calendar-asset-copy">
                    <strong>{title}</strong>
                    <span>官方培养计划 · {formatBytes(attachment.bytes)}</span>
                  </div>
                  <button
                    type="button"
                    className="academic-calendar-open"
                    aria-label={`阅读${title}`}
                    title={`阅读${title}`}
                    disabled={openingAttachmentId === attachment.id}
                    onClick={() => url ? setPreview({ title, url }) : void openFallback(attachment)}
                  >
                    <Maximize2 size={16} />
                  </button>
                </article>
              );
            })}
          </div>
        ) : (
          <EmptyState icon={FileText} title={status === "failed" ? "培养计划读取失败" : "尚未取得官方培养计划 PDF"} detail="点击右上角重新读取；成功后可直接阅读教务系统返回的原始文件。" />
        )}
      </section>

      <Dialog
        open={Boolean(preview)}
        onOpenChange={(open) => {
          if (!open) setPreview(null);
        }}
      >
        {preview && (
          <DialogContent className="academic-calendar-pdf-dialog">
            <div className="academic-calendar-pdf-heading">
              <div className="academic-calendar-pdf-heading-icon">
                <FileText size={18} />
              </div>
              <div>
                <DialogTitle>{preview.title}</DialogTitle>
                <DialogDescription>培养计划 · 本地 PDF 阅读</DialogDescription>
              </div>
            </div>
            <iframe
              className="academic-calendar-pdf-reader"
              title={preview.title}
              src={`${preview.url}#toolbar=1&navpanes=0&view=FitH`}
            />
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}
