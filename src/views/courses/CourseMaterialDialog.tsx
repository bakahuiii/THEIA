import { ExternalLink } from "lucide-react";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../../components/ui/dialog";

export interface CourseMaterialDetail {
  label: string;
  value: string;
}

export interface CourseMaterialSelection {
  kind: "course-info" | "teaching-material" | "resource" | "link";
  title: string;
  url: string | null;
  sourceLabel: string;
  preview?: string | null;
  details?: CourseMaterialDetail[];
}

export function CourseMaterialDialog({
  selection,
  onOpenChange,
  onOpenSource,
}: {
  selection: CourseMaterialSelection | null;
  onOpenChange: (open: boolean) => void;
  onOpenSource: (url: string) => Promise<unknown>;
}) {
  const canOpenSource = Boolean(selection?.url && /^https?:\/\//iu.test(selection.url));

  return (
    <Dialog
      open={Boolean(selection)}
      onOpenChange={onOpenChange}
    >
      {selection && (
        <DialogContent className="course-material-dialog">
          <div className="course-material-dialog-head">
            <div className="course-material-dialog-title">
              <DialogTitle>{selection.title}</DialogTitle>
              <DialogDescription>{selection.sourceLabel}</DialogDescription>
              {selection.url && (
                <p className="course-material-url">{selection.url}</p>
              )}
            </div>
            <span className="source-tag">
              {selection.kind === "course-info"
                ? "基本信息"
                : selection.kind === "teaching-material"
                  ? "课程资料"
                  : selection.kind === "resource"
                    ? "课程资源"
                    : "课程入口"}
            </span>
          </div>

          {selection.details?.length ? (
            <dl className="course-material-details">
              {selection.details.map((detail) => (
                <div key={detail.label}>
                  <dt>{detail.label}</dt>
                  <dd>{detail.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}

          <section className="course-material-preview-pane">
            <div className="course-material-preview-head">
              <h4>{selection.preview ? "内置预览" : "来源说明"}</h4>
              <button
                type="button"
                className="icon-button"
                title={canOpenSource ? "打开学校原站" : "当前条目没有可打开的来源"}
                aria-label={canOpenSource ? "打开学校原站" : "当前条目没有可打开的来源"}
                disabled={!canOpenSource}
                onClick={() => {
                  if (selection.url) void onOpenSource(selection.url)
                }}
              >
                <ExternalLink size={15} />
              </button>
            </div>
            {selection.preview ? (
              <pre className="course-material-preview-text">{selection.preview}</pre>
            ) : (
              <p className="course-material-empty">
                当前条目没有可直接预览的正文。你可以打开学校原站查看完整内容。
              </p>
            )}
            <div className="course-material-dialog-footer">
              <button
                type="button"
                className="link-button course-info-button"
                disabled={!canOpenSource}
                onClick={() => {
                  if (selection.url) void onOpenSource(selection.url)
                }}
              >
                <ExternalLink size={14} /> 打开学校原站
              </button>
            </div>
          </section>
        </DialogContent>
      )}
    </Dialog>
  )
}
