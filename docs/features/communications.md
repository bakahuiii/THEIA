# 通知与邮箱

## 页面目标

这个页面把校园邮箱和学校通知放在一起看，减少在多个来源之间来回切换。

## 主要内容

- 左侧是校园邮箱，右侧是通知。
- 两边都支持搜索。
- 邮箱里显示未读数、发件人、主题、摘要和附件数。
- 打开邮件后可以重新载入原始正文。
- HTML 邮件按安全沙箱渲染，纯文本邮件直接显示正文。
- 附件可单独下载到本机。
- 通知列表支持分页和详情弹窗。

## 数据来源

- state.emails
- state.notices
- IMAP 收到的邮件列表
- 教务系统和 THEOL 通知流

## 边界

- 这里只读，不发信。
- 邮件正文和附件都来自本机缓存或重新读取的结果。
- 通知和邮箱都只做查看，不在这里做进一步的学校侧动作。

## 相关文件

- src/views/CommunicationsView.tsx
- src/views/MailboxView.tsx
- src/views/AssignmentsView.tsx

## 细节

### 邮箱

- 左侧邮箱会显示未读数、发件人、主题、摘要和附件数。
- 点击邮件后会先尝试直接显示已有 HTML；如果不够新，就重新读取原始内容。
- 邮件列表支持按发件人、主题和摘要搜索。

### 邮件正文和附件

- HTML 邮件用 sandbox iframe 展示，避免把页面当成普通应用脚本执行。
- 纯文本邮件直接显示正文或摘要。
- 附件可以单独下载，下载结果会在页面上反馈文件名。

### 通知

- 右侧通知页会把教务系统和 THEOL 动态放在一起。
- 通知卡片可以打开详情弹窗，弹窗里会保留来源、发布时间和本机记录 ID。
- 通知和邮件都只做查看，不在这里发起学校侧动作。

### 分页与空态

- 两边列表都支持分页。
- 空邮件时会明确提示要先在“数据”里配置校园邮箱。
- 空通知时会提示同步后再看，不会把它写成错误。

## 代码级细节

- CommunicationsView 只有 mailQuery、noticeQuery 和 unreadMailCount 三个本地状态，真正的列表都交给 MailboxView 和 NoticesView。
- MailboxView 的核心状态是 selected、loadingId、detailError、downloading、downloadMessage 和 page。
- openMail 会先看 bodyHtmlVersion 是否已经是 4；如果不是，就通过 bridge.readMailboxMessage(mail.id, { refresh }) 重新读正文。
- mailboxDocument 会给 HTML 邮件包一层受限的 iframe 文档，避免正文直接跑到应用环境里。
- downloadAttachment 会调用 bridge.downloadMailboxAttachment，并把返回的文件名写进 downloadMessage。
- NoticesView 通过 selected Notice 打开 Dialog，分页固定 50 条一页，search 会同时匹配来源、标题和摘要。
