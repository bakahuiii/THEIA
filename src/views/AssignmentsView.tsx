import { Bell, CheckCircle2, ChevronLeft, ChevronRight, FileText } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { AssignmentRow } from "../components/AssignmentRow";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "../components/ui/dialog";
import {
  EmptyState,
  formatDate,
  isExpiredAssignment,
  sourceLabel,
} from "../ui/app-shared";
import type {
  Assignment,
  CampusState,
  CourseWorkspace,
  Notice,
} from "../types";

type AssignmentViewProps = {
  items: Assignment[];
  workspaces: CourseWorkspace[];
  workingId: string | null;
  onPrepare: (assignmentId: string) => void;
  onOpenWorkspace: (assignmentId: string) => void;
  onImportAnswerKey: (assignmentId: string) => void;
  onApplyTestAnswers: (assignmentId: string) => void;
  onOpenSubmission: (assignmentId: string) => void;
  onOpenSource: (assignmentId: string) => void;
  onProcessWithModel: (assignmentId: string) => void;
  onGenerateNotes: (assignmentId: string) => void;
  onGeneratePaper: (assignmentId: string) => void;
  onRenderPdf: (assignmentId: string, fileKey: string) => void;
  onOpenPdf: (assignmentId: string) => void;
  modelConfigured: boolean;
};

const LIST_PAGE_SIZE = 50;

export function AssignmentsView({
  items,
  workspaces,
  workingId,
  ...actions
}: AssignmentViewProps) {
  const [mode, setMode] = useState<"pending" | "submitted" | "all">("pending");
  const [page, setPage] = useState(0);
  const workspaceByAssignment = useMemo(
    () => new Map(workspaces.map((item) => [item.assignmentId, item])),
    [workspaces],
  );
  const filtered = useMemo(
    () =>
      items
        .filter((item) => !isExpiredAssignment(item))
        .filter(
          (item) =>
            mode === "all" ||
            (mode === "submitted"
              ? item.status === "submitted"
              : item.status !== "submitted"),
        )
        .sort(
          (left, right) =>
            (left.dueAt ? new Date(left.dueAt).getTime() : Infinity) -
            (right.dueAt ? new Date(right.dueAt).getTime() : Infinity),
        ),
    [items, mode],
  );
  const pageCount = Math.max(1, Math.ceil(filtered.length / LIST_PAGE_SIZE));
  useEffect(() => setPage(0), [mode]);
  useEffect(() => {
    if (page >= pageCount) setPage(pageCount - 1);
  }, [page, pageCount]);
  const pageItems = filtered.slice(page * LIST_PAGE_SIZE, (page + 1) * LIST_PAGE_SIZE);
  return (
    <div className="data-page">
      <div className="segmented">
        <button
          className={mode === "pending" ? "active" : ""}
          onClick={() => setMode("pending")}
        >
          待完成
        </button>
        <button
          className={mode === "submitted" ? "active" : ""}
          onClick={() => setMode("submitted")}
        >
          已提交
        </button>
        <button
          className={mode === "all" ? "active" : ""}
          onClick={() => setMode("all")}
        >
          全部
        </button>
      </div>
      {filtered.length ? (
        <div className="panel task-list wide">
            {pageItems.map((item) => (
            <AssignmentRow
              item={item}
              key={item.id}
              workspace={workspaceByAssignment.get(item.id)}
              working={workingId === item.id}
              {...actions}
            />
          ))}
          {filtered.length > LIST_PAGE_SIZE && (
            <nav className="communications-pagination" aria-label="作业分页">
              <button type="button" className="icon-button" onClick={() => setPage((value) => Math.max(0, value - 1))} disabled={page === 0} aria-label="上一页" title="上一页"><ChevronLeft size={16} /></button>
              <span>{page * LIST_PAGE_SIZE + 1}–{Math.min((page + 1) * LIST_PAGE_SIZE, filtered.length)} / {filtered.length}</span>
              <button type="button" className="icon-button" onClick={() => setPage((value) => Math.min(pageCount - 1, value + 1))} disabled={page >= pageCount - 1} aria-label="下一页" title="下一页"><ChevronRight size={16} /></button>
            </nav>
          )}
        </div>
      ) : (
        <EmptyState
          icon={CheckCircle2}
          title="当前没有任务"
          detail="已自动隐藏超过截止时间的课程任务"
        />
      )}
    </div>
  );
}

export function NoticesView({ state, query = "" }: { state: CampusState; query?: string }) {
  const [selected, setSelected] = useState<Notice | null>(null);
  const [page, setPage] = useState(0);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleNotices = normalizedQuery
    ? state.notices.filter((notice) =>
        [sourceLabel(notice.source), notice.title, notice.summary]
          .filter(Boolean)
          .some((value) => String(value).toLocaleLowerCase().includes(normalizedQuery)),
      )
    : state.notices;
  const pageCount = Math.max(1, Math.ceil(visibleNotices.length / LIST_PAGE_SIZE));
  useEffect(() => setPage(0), [query]);
  useEffect(() => {
    if (page >= pageCount) setPage(pageCount - 1);
  }, [page, pageCount]);
  const pageNotices = visibleNotices.slice(page * LIST_PAGE_SIZE, (page + 1) * LIST_PAGE_SIZE);
  if (!state.notices.length)
    return (
      <EmptyState
        icon={Bell}
        title="暂无通知"
        detail="教务系统通知会在同步后显示在这里"
      />
    );

  if (!visibleNotices.length)
    return (
      <EmptyState
        icon={Bell}
        title="没有匹配的通知"
        detail="试试搜索通知标题、来源或摘要。"
      />
    );

  return (
    <>
      <div className="notice-list">
        {pageNotices.map((notice) => (
          <article key={notice.id}>
            <button
              type="button"
              className="notice-open-button"
              onClick={() => setSelected(notice)}
              aria-label={`查看通知：${notice.title}`}
            >
              <div className={`notice-source ${notice.source}`}>
                <Bell size={17} />
              </div>
              <div className="notice-copy">
                <div className="notice-meta">
                  <span>{sourceLabel(notice.source)}</span>
                  <time>{formatDate(notice.publishedAt)}</time>
                </div>
                <h3>{notice.title}</h3>
                {notice.summary && <p>{notice.summary}</p>}
              </div>
              <span className="notice-disclosure" aria-hidden="true">
                <ChevronRight size={18} />
              </span>
            </button>
          </article>
        ))}
      </div>
      {visibleNotices.length > LIST_PAGE_SIZE && (
        <nav className="communications-pagination" aria-label="通知分页">
          <button type="button" className="icon-button" onClick={() => setPage((value) => Math.max(0, value - 1))} disabled={page === 0} aria-label="上一页" title="上一页"><ChevronLeft size={16} /></button>
          <span>{page * LIST_PAGE_SIZE + 1}–{Math.min((page + 1) * LIST_PAGE_SIZE, visibleNotices.length)} / {visibleNotices.length}</span>
          <button type="button" className="icon-button" onClick={() => setPage((value) => Math.min(pageCount - 1, value + 1))} disabled={page >= pageCount - 1} aria-label="下一页" title="下一页"><ChevronRight size={16} /></button>
        </nav>
      )}

      <Dialog
        open={Boolean(selected)}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      >
        {selected && (
          <DialogContent className="notice-detail-dialog">
            <div className="notice-detail-heading">
              <div className={`notice-source ${selected.source}`}>
                <FileText size={18} />
              </div>
              <div>
                <DialogTitle>{selected.title}</DialogTitle>
                <DialogDescription>
                  {sourceLabel(selected.source)} · {formatDate(selected.publishedAt)}
                </DialogDescription>
              </div>
            </div>
            <div className="notice-detail-body">
              <p>{selected.summary || "该通知未提供正文摘要。"}</p>
            </div>
            <dl className="notice-detail-facts">
              <div>
                <dt>信息来源</dt>
                <dd>{sourceLabel(selected.source)}</dd>
              </div>
              <div>
                <dt>发布时间</dt>
                <dd>{formatDate(selected.publishedAt)}</dd>
              </div>
              <div>
                <dt>本机记录</dt>
                <dd>{selected.id}</dd>
              </div>
            </dl>
          </DialogContent>
        )}
      </Dialog>
    </>
  );
}
