# THEIA 启动失败诊断与修复

## 问题：安装后无法打开（无界面，无错误提示）

### 根本原因
1. **进程残留**：前一个 THEIA 实例崩溃或未正常退出，进程仍在后台运行
2. **单实例锁冲突**：新实例检测到锁被占用，静默退出
3. **无用户反馈**：没有任何对话框或错误提示

### 立即解决方案（用户端）

#### 方法 1：强制结束残留进程
```powershell
# 查找 THEIA 进程
Get-Process | Where-Object {$_.ProcessName -like "*THEIA*" -or $_.ProcessName -eq "THEIA"}

# 强制结束所有 THEIA 进程
Get-Process | Where-Object {$_.ProcessName -like "*THEIA*"} | Stop-Process -Force

# 等待几秒后重新启动 THEIA
Start-Sleep -Seconds 2
```

#### 方法 2：清理单实例锁文件
```powershell
# 删除可能残留的 Electron 单实例锁
Remove-Item "$env:APPDATA\THEIA\SingletonLock" -Force -ErrorAction SilentlyContinue
Remove-Item "$env:APPDATA\THEIA\SingletonSocket" -Force -ErrorAction SilentlyContinue
Remove-Item "$env:APPDATA\THEIA\SingletonCookie" -Force -ErrorAction SilentlyContinue

# 删除数据存储锁
Remove-Item "$env:APPDATA\THEIA\data\.write.lock" -Force -ErrorAction SilentlyContinue
```

#### 方法 3：完全重置（保留数据）
```powershell
# 备份用户数据
Copy-Item "$env:APPDATA\THEIA" "$env:APPDATA\THEIA.backup" -Recurse -Force

# 结束进程
Get-Process | Where-Object {$_.ProcessName -like "*THEIA*"} | Stop-Process -Force

# 删除所有锁文件和会话数据
Remove-Item "$env:APPDATA\THEIA\session" -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item "$env:APPDATA\THEIA\SingletonLock" -Force -ErrorAction SilentlyContinue
Remove-Item "$env:APPDATA\THEIA\SingletonSocket" -Force -ErrorAction SilentlyContinue
Remove-Item "$env:APPDATA\THEIA\SingletonCookie" -Force -ErrorAction SilentlyContinue
Remove-Item "$env:APPDATA\THEIA\data\.write.lock" -Force -ErrorAction SilentlyContinue

# 重新启动 THEIA
```

### 代码层面修复方案

#### 修复 1：添加用户友好的错误提示
```javascript
// electron/main.mjs
const lock = app.requestSingleInstanceLock()
if (!lock) {
  // 显示错误对话框
  app.whenReady().then(() => {
    dialog.showErrorBoxSync(
      'THEIA 已在运行',
      'THEIA 的另一个实例正在运行。\n\n' +
      '如果您确认没有其他实例，请：\n' +
      '1. 打开任务管理器，结束所有 THEIA 进程\n' +
      '2. 重新启动 THEIA'
    )
    app.quit()
  })
} else {
  // 正常启动流程...
}
```

#### 修复 2：添加启动日志
```javascript
// 在应用启动时立即写入日志
const startupLog = resolve(app.getPath('userData'), 'startup.log')
const logStartup = (message) => {
  const timestamp = new Date().toISOString()
  appendFileSync(startupLog, `${timestamp} ${message}\n`, 'utf8')
}

logStartup('[THEIA] Application starting')
const lock = app.requestSingleInstanceLock()
if (!lock) {
  logStartup('[THEIA] Single instance lock failed - another instance is running')
  // 显示错误...
}
logStartup('[THEIA] Single instance lock acquired')
```

#### 修复 3：检测并清理孤立锁
```javascript
async function cleanStaleInstanceLock() {
  const lockFiles = [
    resolve(app.getPath('userData'), 'SingletonLock'),
    resolve(app.getPath('userData'), 'SingletonSocket'),
    resolve(app.getPath('userData'), 'SingletonCookie'),
  ]
  
  for (const lockFile of lockFiles) {
    try {
      const stat = await lstat(lockFile)
      const age = Date.now() - stat.mtimeMs
      // 如果锁文件超过 5 分钟，可能是孤立的
      if (age > 5 * 60 * 1000) {
        await rm(lockFile, { force: true })
        console.log(`[THEIA] Removed stale lock file: ${lockFile}`)
      }
    } catch {
      // 文件不存在或无法访问，跳过
    }
  }
}

// 在请求锁之前清理
await cleanStaleInstanceLock()
const lock = app.requestSingleInstanceLock()
```

### Windows 11 25H2 特定问题

#### 可能的权限问题
Windows 11 25H2 可能有更严格的 AppData 权限：

```powershell
# 检查 THEIA 目录权限
Get-Acl "$env:APPDATA\THEIA" | Format-List

# 如果权限异常，重置为当前用户完全控制
$acl = Get-Acl "$env:APPDATA\THEIA"
$rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
    $env:USERNAME, "FullControl", "ContainerInherit,ObjectInherit", "None", "Allow"
)
$acl.SetAccessRule($rule)
Set-Acl "$env:APPDATA\THEIA" $acl
```

#### 可能的反病毒/安全软件干扰
- Windows Defender 或第三方安全软件可能阻止 THEIA 写入 AppData
- 检查 Windows 安全中心 → 病毒和威胁防护 → 保护历史记录
- 临时添加 THEIA 到排除列表测试

### 测试步骤

1. **确认进程残留**：
   ```powershell
   Get-Process | Where-Object {$_.ProcessName -like "*THEIA*"} | Format-Table Id, ProcessName, StartTime, Path
   ```

2. **检查锁文件**：
   ```powershell
   Get-ChildItem "$env:APPDATA\THEIA" -Filter "*Lock*" -Recurse -Force | Format-Table FullName, LastWriteTime
   Get-ChildItem "$env:APPDATA\THEIA" -Filter "*Socket*" -Recurse -Force | Format-Table FullName, LastWriteTime
   ```

3. **查看启动日志**（修复后）：
   ```powershell
   Get-Content "$env:APPDATA\THEIA\startup.log" -Tail 20
   ```

4. **测试清理脚本**：
   创建 `fix-theia-startup.bat`：
   ```batch
   @echo off
   echo 正在清理 THEIA 残留进程和锁文件...
   
   REM 结束所有 THEIA 进程
   taskkill /F /IM THEIA.exe 2>nul
   
   REM 等待进程完全退出
   timeout /t 2 /nobreak >nul
   
   REM 删除锁文件
   del "%APPDATA%\THEIA\SingletonLock" 2>nul
   del "%APPDATA%\THEIA\SingletonSocket" 2>nul
   del "%APPDATA%\THEIA\SingletonCookie" 2>nul
   del "%APPDATA%\THEIA\data\.write.lock" 2>nul
   
   echo 清理完成，请重新启动 THEIA
   pause
   ```

### 建议的代码改进优先级

1. **高优先级**：添加错误对话框提示（让用户知道发生了什么）
2. **中优先级**：添加启动日志（便于远程诊断）
3. **中优先级**：改进 `shutdownServices` 的鲁棒性（确保完全退出）
4. **低优先级**：孤立锁自动清理（需谨慎，避免误杀正常实例）
