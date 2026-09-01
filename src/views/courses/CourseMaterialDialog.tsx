import { FolderOpen } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../../components/ui/dialog";

export interface CourseMaterialDetail {
  label: string;
  value: string;
}

export interface CourseMaterialSelection {
  kind: "course-info" | "teaching-material" | "resource" | "link";
  title: string;
  url: string | null;
  courseId?: string | null;
  materialId?: string | null;
  sourceLabel: string;
  preview?: string | null;
  details?: CourseMaterialDetail[];
}

export function CourseMaterialDialog({
  selection,
  onOpenChange,
  onOpenLocal,
}: {
  selection: CourseMaterialSelection | null;
  onOpenChange: (open: boolean) => void;
  onOpenLocal: (courseId: string, materialId: string) => Promise<unknown>;
}) {
  const canOpenLocal = Boolean(selection?.courseId && selection?.materialId);

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
              <h4>{selection.preview ? "本地预览" : "归档说明"}</h4>
              <button
                type="button"
                className="icon-button"
                title={canOpenLocal ? "打开本地文件" : "当前条目没有可打开的本地文件"}
                aria-label={canOpenLocal ? "打开本地文件" : "当前条目没有可打开的本地文件"}
                disabled={!canOpenLocal}
                onClick={() => {
                  if (selection.courseId && selection.materialId) void onOpenLocal(selection.courseId, selection.materialId)
                }}
              >
                <FolderOpen size={15} />
              </button>
            </div>
            {selection.preview ? (
              <pre className="course-material-preview-text">{selection.preview}</pre>
            ) : (
              <p className="course-material-empty">
                当前条目没有可直接预览的正文，或本地归档失败。
              </p>
            )}
            <div className="course-material-dialog-footer">
              <button
                type="button"
                className="link-button course-info-button"
                disabled={!canOpenLocal}
                onClick={() => {
                  if (selection.courseId && selection.materialId) void onOpenLocal(selection.courseId, selection.materialId)
                }}
              >
                <FolderOpen size={14} /> 打开本地文件
              </button>
            </div>
          </section>
        </DialogContent>
      )}
    </Dialog>
  )
}
