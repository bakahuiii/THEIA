import { ChevronLeft, ChevronRight, Download, FileText, Inbox, LoaderCircle, Mail, Paperclip, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { bridge } from "../bridge";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../components/ui/dialog";
import type { EmailMessage } from "../types";
import { EmptyState, THEIA_TIME_ZONE } from "../ui/app-shared";

function formatMailboxTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: THEIA_TIME_ZONE,
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(date).reduce<Record<string, string>>((result, part) => ({ ...result, [part.type]: part.value }), {});
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

function formatSize(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "未知大小";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.ceil(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const MAIL_PAGE_SIZE = 50;

function mailboxDocument(html: string) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'"><style>html{min-height:100%;background:#fff;color-scheme:light}body{box-sizing:border-box;min-height:100%;max-width:920px;margin:0 auto;padding:clamp(28px,5vw,54px);color:#202124;background:#fff;font:15px/1.72 -apple-system,BlinkMacSystemFont,'Segoe UI','Microsoft YaHei',sans-serif;word-break:break-word}*,*:before,*:after{box-sizing:border-box}body>table:first-of-type{margin-left:auto;margin-right:auto}img{display:block;max-width:100% !important;height:auto !important;margin:18px auto}table{max-width:100% !important;height:auto !important;border-collapse:collapse}td,th{max-width:100%;overflow-wrap:anywhere}a{color:#0969da;text-decoration:none}a:hover{text-decoration:underline}blockquote{margin:20px 0;padding:4px 0 4px 18px;color:#57606a;border-left:3px solid #d0d7de}pre,code{font-family:ui-monospace,SFMono-Regular,Consolas,monospace}pre{max-width:100%;overflow:auto;padding:14px;background:#f6f8fa;border-radius:8px}@media(max-width:640px){body{padding:24px 18px;font-size:14px}}</style></head><body>${html}<style>html,body{height:auto !important;min-height:0 !important;overflow:visible !important}body{overflow-x:hidden !important}</style></body></html>`;
}

export function MailboxView({ emails, query = "" }: { emails: EmailMessage[]; query?: string }) {
  const [selected, setSelected] = useState<EmailMessage | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [downloadMessage, setDownloadMessage] = useState<string | null>(null);
  const [page, setPage] = useState(0);

  const openMail = async (mail: EmailMessage, refresh = false) => {
    const currentHtml = Boolean(mail.bodyHtml && mail.bodyHtmlVersion === 4);
    setSelected(currentHtml ? mail : { ...mail, bodyHtml: null });
    setDetailError(null);
    setDownloadMessage(null);
    if (currentHtml && !refresh) return;
    setLoadingId(mail.id);
    try {
      setSelected(await bridge.readMailboxMessage(mail.id, { refresh }));
    } catch (error) {
      setDetailError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoadingId(null);
    }
  };

  const reloadMail = () => {
    if (selected) void openMail(selected, true);
  };

  const downloadAttachment = async (mail: EmailMessage, index: number, filename: string) => {
    const key = `${mail.id}:${index}`;
    setDownloading(key);
    setDownloadMessage(null);
    try {
      const result = await bridge.downloadMailboxAttachment(mail.id, index);
      if (!result.canceled) setDownloadMessage(`已保存 ${result.filename || filename}`);
    } catch (error) {
      setDownloadMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setDownloading(null);
    }
  };

  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleEmails = normalizedQuery
    ? emails.filter((mail) =>
        [mail.from, mail.subject, mail.snippet]
          .filter(Boolean)
          .some((value) => String(value).toLocaleLowerCase().includes(normalizedQuery)),
      )
    : emails;
  const pageCount = Math.max(1, Math.ceil(visibleEmails.length / MAIL_PAGE_SIZE));
  useEffect(() => setPage(0), [query]);
  useEffect(() => {
    if (page >= pageCount) setPage(pageCount - 1);
  }, [page, pageCount]);
  const pageEmails = visibleEmails.slice(page * MAIL_PAGE_SIZE, (page + 1) * MAIL_PAGE_SIZE);

  if (!emails.length) {
    return <EmptyState icon={Inbox} title="收件箱为空" detail="在“数据”中配置校园邮箱后，邮件会保存在本机并显示在这里。" />;
  }

  if (!visibleEmails.length) {
    return <EmptyState icon={Inbox} title="没有匹配的邮件" detail="试试搜索发件人、主题或邮件摘要。" />;
  }

  return <>
    <div className="notice-list mailbox-list">
      {pageEmails.map((mail) => <article key={mail.id} className={mail.unread ? "mailbox-row unread" : "mailbox-row"}>
        <button type="button" className="notice-open-button mailbox-open-button" onClick={() => void openMail(mail)} aria-label={`查看邮件：${mail.subject}`}>
          <div className="notice-source imap"><Mail size={17} /></div>
          <div className="notice-copy mailbox-copy">
            <div className="mailbox-sender">{mail.unread && <i className="mail-unread-dot" aria-label="未读" />} {mail.from}</div>
            <h3>{mail.subject}</h3>
            {mail.snippet && <p>{mail.snippet}</p>}
          </div>
          <div className="mailbox-side-meta">
            <time>{formatMailboxTime(mail.receivedAt)}</time>
            {mail.attachments?.length ? <span className="mailbox-attachment-count"><Paperclip size={14} /> {mail.attachments.length}</span> : null}
          </div>
        </button>
      </article>)}
    </div>
    <Dialog open={Boolean(selected)} onOpenChange={(open) => { if (!open) { setSelected(null); setDetailError(null); setDownloadMessage(null); } }}>
      {selected && <DialogContent className="notice-detail-dialog mailbox-detail-dialog">
        <div className="notice-detail-heading mailbox-detail-heading">
          <div className="notice-source imap"><FileText size={18} /></div>
          <div className="mailbox-detail-title"><DialogTitle>{selected.subject}</DialogTitle><DialogDescription>{selected.from} · {formatMailboxTime(selected.receivedAt)}</DialogDescription></div>
          <button type="button" className="mail-reader-reload" onClick={reloadMail} disabled={loadingId === selected.id} title="重新从邮箱读取并渲染原始邮件">
            <RefreshCw size={15} className={loadingId === selected.id ? "mail-download-spinner" : undefined} />
            <span>重新载入</span>
          </button>
        </div>
        <div className="notice-detail-body mailbox-detail-body">
          {loadingId === selected.id && <p className="mail-detail-loading"><LoaderCircle size={16} /> 正在读取邮件正文…</p>}
          {detailError && <p className="mail-detail-error">{detailError}</p>}
          {!loadingId && !detailError && (selected.bodyHtml
            ? <iframe className="mail-html-frame" title={selected.subject} sandbox="allow-same-origin allow-popups" scrolling="auto" srcDoc={mailboxDocument(selected.bodyHtml)} />
            : <p>{selected.body || selected.snippet || "该邮件没有可显示的内容。"}</p>)}
        </div>
        {selected.attachments?.length ? <section className="mailbox-attachments" aria-label="附件">
          <h4>附件</h4>
          <div className="mailbox-attachment-list">
            {selected.attachments.map((file, index) => {
              const attachmentIndex = file.index ?? index;
              const key = `${selected.id}:${attachmentIndex}`;
              return <div className="mailbox-attachment" key={`${attachmentIndex}:${file.filename}`}>
                <Paperclip size={16} />
                <div><strong>{file.filename}</strong><span>{formatSize(file.size)}</span></div>
                <button type="button" onClick={() => void downloadAttachment(selected, attachmentIndex, file.filename)} disabled={downloading === key}>
                  {downloading === key ? <LoaderCircle size={15} className="mail-download-spinner" /> : <Download size={15} />} 下载
                </button>
              </div>;
      })}
    </div>
    {visibleEmails.length > MAIL_PAGE_SIZE && (
      <nav className="communications-pagination" aria-label="校园邮箱分页">
        <button type="button" className="icon-button" onClick={() => setPage((value) => Math.max(0, value - 1))} disabled={page === 0} aria-label="上一页" title="上一页"><ChevronLeft size={16} /></button>
        <span>{page * MAIL_PAGE_SIZE + 1}–{Math.min((page + 1) * MAIL_PAGE_SIZE, visibleEmails.length)} / {visibleEmails.length}</span>
        <button type="button" className="icon-button" onClick={() => setPage((value) => Math.min(pageCount - 1, value + 1))} disabled={page >= pageCount - 1} aria-label="下一页" title="下一页"><ChevronRight size={16} /></button>
      </nav>
    )}
          {downloadMessage && <p className="mail-download-message">{downloadMessage}</p>}
        </section> : null}
      </DialogContent>}
    </Dialog>
  </>;
}
