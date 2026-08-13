import { Bell, Inbox, Search } from "lucide-react";
import { useState } from "react";
import { MailboxView } from "./MailboxView";
import { NoticesView } from "./AssignmentsView";
import type { CampusState } from "../types";

export function CommunicationsView({ state }: { state: CampusState }) {
  const [mailQuery, setMailQuery] = useState("");
  const [noticeQuery, setNoticeQuery] = useState("");
  const unreadMailCount = state.emails.filter((email) => email.unread).length;

  return (
    <div className="communications-view">
      <section className="communications-pane communications-mailbox-pane" aria-labelledby="mailbox-heading">
        <header className="communications-pane-heading">
          <div className="communications-pane-title">
            <span className="communications-pane-icon mailbox"><Inbox size={18} /></span>
            <div>
              <h2 id="mailbox-heading">校园邮箱</h2>
              <p>保存在本机的收件箱</p>
            </div>
          </div>
          <div className="communications-pane-tools">
            <label className="communications-search">
              <Search size={14} aria-hidden="true" />
              <input
                value={mailQuery}
                onChange={(event) => setMailQuery(event.target.value)}
                placeholder="搜索邮件"
                aria-label="搜索校园邮箱"
              />
            </label>
            <span className="communications-count" title={unreadMailCount ? `${unreadMailCount} 封未读` : "全部已读"}>
              {unreadMailCount ? `${unreadMailCount} 未读` : `${state.emails.length} 封`}
            </span>
          </div>
        </header>
        <div className="communications-pane-content">
          <MailboxView emails={state.emails} query={mailQuery} />
        </div>
      </section>

      <section className="communications-pane communications-notices-pane" aria-labelledby="notices-heading">
        <header className="communications-pane-heading">
          <div className="communications-pane-title">
            <span className="communications-pane-icon notices"><Bell size={18} /></span>
            <div>
              <h2 id="notices-heading">通知</h2>
              <p>教务系统与北化在线THEOL动态</p>
            </div>
          </div>
          <div className="communications-pane-tools">
            <label className="communications-search">
              <Search size={14} aria-hidden="true" />
              <input
                value={noticeQuery}
                onChange={(event) => setNoticeQuery(event.target.value)}
                placeholder="搜索通知"
                aria-label="搜索通知"
              />
            </label>
            <span className="communications-count">{state.notices.length} 条</span>
          </div>
        </header>
        <div className="communications-pane-content">
          <NoticesView state={state} query={noticeQuery} />
        </div>
      </section>
    </div>
  );
}
