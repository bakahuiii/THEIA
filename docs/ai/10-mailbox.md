# 校园邮箱

## 当前路径

自动收信使用 `core/imap-mail-service.mjs`，通过企业邮箱 IMAP over TLS。浏览器 webmail 服务只保留手动打开/兼容辅助，不应重新成为默认轮询路径。

邮箱凭据在 `electron/mail-vault.mjs`，支持邮箱密码或客户端授权码，优先 `protocolPassword`。不得保存、打印或导出凭据。

## 数据与性能

- 轮询只读取 INBOX 元数据，最多 500 封；正文和附件按需 IMAP 读取。
- 已读取正文存入 `emails[].bodyHtml/body`；HTML 版本字段用于旧缓存升级。
- 附件下载重新读取原邮件，不把二进制附件写进主状态。
- 新邮件只在已有初始快照后通知，避免首次同步通知风暴。

## HTML 安全与视觉

正文经 Cheerio 消毒：移除 script、form、frame、嵌入媒体和危险 CSS；保留安全 class/id、表格属性、内联样式及受限 style block，确保 GitHub 等表格邮件正常显示。远程 `http/https` 图片可显示，链接在隔离新窗口打开。

`MailboxView.tsx` 用 CSP 锁定、无脚本 iframe 渲染正文。长邮件只有 iframe 自身滚动，外层 dialog 不二次滚动；不要恢复基于正文高度的硬上限。改 sanitizer 必须更新 `tests/imap-mail-service.test.mjs`，日志不得记录正文。

