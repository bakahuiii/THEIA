import {
  BookOpen,
  CheckCircle2,
  Clock3,
  ExternalLink,
  FileJson,
  FileUp,
  FolderOpen,
  GraduationCap,
  Play,
} from "lucide-react";
import { formatDate, relativeTime } from "../ui/app-shared";
import type { Assignment, CourseWorkspace } from "../types";

export type AssignmentActions = {
  workspace?: CourseWorkspace;
  working?: boolean;
  onPrepare?: (assignmentId: string) => void;
  onOpenWorkspace?: (assignmentId: string) => void;
  onImportAnswerKey?: (assignmentId: string) => void;
  onApplyTestAnswers?: (assignmentId: string) => void;
  onOpenSubmission?: (assignmentId: string) => void;
  onOpenSource?: (assignmentId: string) => void;
  onProcessWithModel?: (assignmentId: string) => void;
  onGenerateNotes?: (assignmentId: string) => void;
  onGeneratePaper?: (assignmentId: string) => void;
  onRenderPdf?: (assignmentId: string, fileKey: string) => void;
  onOpenPdf?: (assignmentId: string) => void;
  modelConfigured?: boolean;
};

export function AssignmentRow({
  item,
  workspace,
  working,
  onPrepare,
  onOpenWorkspace,
  onImportAnswerKey,
  onApplyTestAnswers,
  onOpenSubmission,
  onOpenSource,
  onProcessWithModel,
  onGenerateNotes,
  onGeneratePaper,
  onRenderPdf,
  onOpenPdf,
  modelConfigured,
}: { item: Assignment } & AssignmentActions) {
  const due = item.dueAt ? new Date(item.dueAt).getTime() - Date.now() : null;
  const urgent = due !== null && due > 0 && due < 48 * 3_600_000;
  const isTest = item.kind === "online-test";
  const kind = isTest ? "在线测试" : "作业";
  const hasPdf =
    workspace?.modelAnswerPdfPath ||
    workspace?.notesPdfPath ||
    workspace?.paperPdfPath;

  return (
    <div className="task-row">
      <span
        className={`task-state ${item.status === "submitted" ? "done" : urgent ? "urgent" : ""}`}
      >
        {item.status === "submitted" ? (
          <CheckCircle2 size={17} />
        ) : (
          <Clock3 size={17} />
        )}
      </span>
      <div className="task-title">
        <strong>{item.title}</strong>
        <span>
          {item.courseName || "未关联课程"} · {kind}
        </span>
        {workspace && (
          <small>
            工作包{" "}
            {workspace.questionCount ? `· ${workspace.questionCount} 题` : ""}
            {workspace.attachmentCount
              ? ` · ${workspace.attachmentCount} 个附件`
              : ""}
          </small>
        )}
      </div>
      <div className="task-due">
        <strong>
          {item.status === "submitted" ? "已提交" : relativeTime(item.dueAt)}
        </strong>
        <span>{formatDate(item.dueAt)}</span>
      </div>
      <div className="task-actions">
        {onPrepare && item.status !== "submitted" && (
          <button
            className="task-command"
            onClick={() => onPrepare(item.id)}
            disabled={working}
          >
            <FolderOpen size={15} />{" "}
            {working ? "正在准备" : workspace ? "重新准备" : "准备工作包"}
          </button>
        )}
        {workspace && onProcessWithModel && (
          <button
            className="task-command"
            onClick={() => onProcessWithModel(item.id)}
            disabled={working || !modelConfigured}
            title={
              modelConfigured
                ? "Use configured model to generate a local answer"
                : "Configure the model service in Settings"
            }
          >
            <Play size={15} /> {working ? "Processing" : "生成答案"}
          </button>
        )}
        {workspace && !isTest && onGenerateNotes && (
          <button
            className="task-command"
            onClick={() => onGenerateNotes(item.id)}
            disabled={working || !modelConfigured}
            title={
              modelConfigured ? "" : "Configure the model service in Settings"
            }
          >
            <BookOpen size={15} /> 生成笔记
          </button>
        )}
        {workspace && !isTest && onGeneratePaper && (
          <button
            className="task-command"
            onClick={() => onGeneratePaper(item.id)}
            disabled={working || !modelConfigured}
            title={
              modelConfigured ? "" : "Configure the model service in Settings"
            }
          >
            <GraduationCap size={15} /> 生成论文
          </button>
        )}
        {workspace?.modelAnswerPath && onRenderPdf && (
          <button
            className="task-command"
            onClick={() => onRenderPdf(item.id, "modelAnswerPath")}
            disabled={working}
          >
            <FileJson size={15} /> 答案→PDF
          </button>
        )}
        {workspace?.notesPath && onRenderPdf && (
          <button
            className="task-command"
            onClick={() => onRenderPdf(item.id, "notesPath")}
            disabled={working}
          >
            <FileJson size={15} /> 笔记→PDF
          </button>
        )}
        {workspace?.paperPath && onRenderPdf && (
          <button
            className="task-command"
            onClick={() => onRenderPdf(item.id, "paperPath")}
            disabled={working}
          >
            <FileJson size={15} /> 论文→PDF
          </button>
        )}
        {hasPdf && onOpenPdf && (
          <button className="task-command" onClick={() => onOpenPdf(item.id)}>
            <ExternalLink size={15} /> 打开 PDF
          </button>
        )}
        {workspace && onOpenWorkspace && (
          <button
            className="task-command"
            onClick={() => onOpenWorkspace(item.id)}
          >
            <FolderOpen size={15} /> 打开工作区
          </button>
        )}
        {workspace && isTest && onImportAnswerKey && (
          <button
            className="task-command"
            onClick={() => onImportAnswerKey(item.id)}
          >
            <FileUp size={15} /> 导入答案 JSON
          </button>
        )}
        {workspace && isTest && onApplyTestAnswers && (
          <button
            className="task-command emphasis"
            onClick={() => onApplyTestAnswers(item.id)}
            disabled={!workspace.answerKeyPath || working}
          >
            <Play size={15} /> 写入测试页
          </button>
        )}
        {workspace && !isTest && onOpenSubmission && (
          <button
            className="task-command emphasis"
            onClick={() => onOpenSubmission(item.id)}
            disabled={working}
          >
            <FileUp size={15} /> 选择文件并提交
          </button>
        )}
        {onOpenSource && (
          <button
            className="task-command"
            onClick={() => onOpenSource(item.id)}
            title={item.localPath ? "打开本地课程任务详情" : "任务详情尚未成功归档"}
          >
            <ExternalLink size={15} /> {item.localPath ? "打开本地详情" : "详情未保存"}
          </button>
        )}
      </div>
    </div>
  );
}
