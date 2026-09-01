# 启动排障

本文只记录当前安装包已经提供的排障入口。不要把删除整个数据目录当作修复方法，用户数据可能因此丢失。

## 双击没有窗口

先等待几秒并检查任务栏、任务管理器中是否已有 THEIA。应用采用单实例锁：已有实例运行时，新启动会显示提示并退出，不会再创建第二个窗口。

如果确认没有正在使用的 THEIA 实例，可以运行安装目录中的 `fix-theia-startup.bat`。脚本只处理明确命名的 THEIA 进程、Electron 单实例文件和数据写锁；运行前应先关闭正在使用的 THEIA 实例。

也可以手动执行：

```powershell
Get-Process -Name THEIA -ErrorAction SilentlyContinue
Stop-Process -Name THEIA -Force -ErrorAction SilentlyContinue

Remove-Item "$env:APPDATA\THEIA\SingletonLock" -Force -ErrorAction SilentlyContinue
Remove-Item "$env:APPDATA\THEIA\SingletonSocket" -Force -ErrorAction SilentlyContinue
Remove-Item "$env:APPDATA\THEIA\SingletonCookie" -Force -ErrorAction SilentlyContinue
Remove-Item "$env:APPDATA\THEIA\data\.write.lock" -Force -ErrorAction SilentlyContinue
```

如果应用仍无法启动，不要继续删除文件。保留 `%APPDATA%\THEIA`，记录 Windows 版本、THEIA 版本和安装方式，再检查诊断文件。

## 启动后立即报错

启动错误会在窗口中显示。应用还会把启动阶段和安全错误写入：

```text
%APPDATA%\THEIA\auth-diagnostics.ndjson
```

分享日志前必须删除姓名、学号、邮件内容、完整 URL 查询参数、路径、Cookie、密码和 API Key。不要上传整个数据目录、浏览器会话目录或课程附件。

## 启动成功但没有数据

1. 确认打开的是桌面客户端，而不是浏览器预览。
2. 在“设置与接入”中完成统一身份认证，然后点击同步。
3. 分别查看教务系统和北化在线 THEOL 的连接状态；一个来源失败不会说明另一个来源也失败。
4. 等待同步进度结束。部分低频资料和 THEOL 课程任务可能在主同步后继续更新。
5. 如果某个数据域失败，优先使用该域的重试入口，不要删除本地数据重来。

## 数据异常

THEIA 使用分片清单和备份清单恢复本地状态。请先退出应用并复制整个数据根作为备份，再收集 `data\manifest.json`、`data\manifest.json.bak` 是否存在以及界面显示的错误。不要手动编辑或删除 `manifest.json`、对象分片、`buct-data.json`、校历资产或工作区。

## 仍无法解决

提交问题时请提供：

- THEIA 版本和 Windows 版本；
- 桌面客户端还是浏览器预览；
- 是否使用了 `THEIA_DATA_ROOT`；
- 可重复的操作、期望结果和实际结果；
- 脱敏后的错误代码或日志片段。

不要提供凭据、Cookie、完整快照、原始网页、邮件正文或任务附件。
