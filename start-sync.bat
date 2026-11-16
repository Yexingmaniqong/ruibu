@echo off
chcp 65001 >nul
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  [!] Node.js not found / 未检测到 Node.js
  echo      Please install it from https://nodejs.org
  echo.
  pause
  exit /b 1
)

node sync-server.js 8899
echo.
echo  Server stopped. / 服务已停止。
pause
