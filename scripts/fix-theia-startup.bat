@echo off
chcp 65001 >nul
echo ========================================
echo THEIA 启动问题修复工具
echo ========================================
echo.

echo [1/3] 正在检查 THEIA 进程...
tasklist /FI "IMAGENAME eq THEIA.exe" 2>NUL | find /I /N "THEIA.exe">NUL
if "%ERRORLEVEL%"=="0" (
    echo 发现 THEIA 进程正在运行，正在强制结束...
    taskkill /F /IM THEIA.exe 2>nul
    if "%ERRORLEVEL%"=="0" (
        echo ✓ 已结束 THEIA 进程
    ) else (
        echo ✗ 无法结束进程，请手动在任务管理器中结束
    )
) else (
    echo ✓ 未发现运行中的 THEIA 进程
)

echo.
echo [2/3] 等待进程完全退出...
timeout /t 3 /nobreak >nul
echo ✓ 等待完成

echo.
echo [3/3] 正在清理锁文件...
set cleaned=0

if exist "%APPDATA%\THEIA\SingletonLock" (
    del "%APPDATA%\THEIA\SingletonLock" 2>nul
    echo ✓ 已删除 SingletonLock
    set /a cleaned+=1
)

if exist "%APPDATA%\THEIA\SingletonSocket" (
    del "%APPDATA%\THEIA\SingletonSocket" 2>nul
    echo ✓ 已删除 SingletonSocket
    set /a cleaned+=1
)

if exist "%APPDATA%\THEIA\SingletonCookie" (
    del "%APPDATA%\THEIA\SingletonCookie" 2>nul
    echo ✓ 已删除 SingletonCookie
    set /a cleaned+=1
)

if exist "%APPDATA%\THEIA\data\.write.lock" (
    del "%APPDATA%\THEIA\data\.write.lock" 2>nul
    echo ✓ 已删除 data\.write.lock
    set /a cleaned+=1
)

if %cleaned%==0 (
    echo ✓ 未发现需要清理的锁文件
)

echo.
echo ========================================
echo 修复完成！
echo ========================================
echo.
echo 现在可以重新启动 THEIA 了
echo.
pause
