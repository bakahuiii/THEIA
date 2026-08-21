# THEIA 无法启动诊断

## 症状
- 安装后双击无反应
- 无界面显示
- 无错误提示

## 根本原因
进程残留 + 单实例锁冲突

## 立即解决（用户操作）

### 方法1：结束残留进程
```powershell
Get-Process | Where-Object {$_.ProcessName -like "*THEIA*"} | Stop-Process -Force
```

### 方法2：清理锁文件
```powershell
Remove-Item "$env:APPDATA\THEIA\SingletonLock" -Force -ErrorAction SilentlyContinue
Remove-Item "$env:APPDATA\THEIA\SingletonSocket" -Force -ErrorAction SilentlyContinue
Remove-Item "$env:APPDATA\THEIA\data\.write.lock" -Force -ErrorAction SilentlyContinue
```

### 方法3：一键修复脚本
创建 fix-theia.bat：
```batch
@echo off
taskkill /F /IM THEIA.exe 2>nul
timeout /t 2 /nobreak >nul
del "%APPDATA%\THEIA\SingletonLock" 2>nul
del "%APPDATA%\THEIA\SingletonSocket" 2>nul
del "%APPDATA%\THEIA\data\.write.lock" 2>nul
echo 已清理，请重启 THEIA
pause
```

## 代码修复方案

### 1. 添加错误提示
```javascript
if (!lock) {
  app.whenReady().then(() => {
    dialog.showErrorBoxSync('THEIA 已在运行', 
      'THEIA 的另一个实例正在运行。\n请在任务管理器中结束 THEIA 进程后重试。')
    app.quit()
  })
}
```

### 2. 改进关闭流程
确保 shutdownServices 中的 store?.drain() 已添加（已完成 eeb1c18）

### 3. 添加启动日志
便于远程诊断问题
