@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
    echo Node.js is not installed. Install it from https://nodejs.org and try again.
    pause
    exit /b 1
)

start "Doctors on Wheels Server" cmd /c node "%~dp0serve.js"
timeout /t 2 >nul
start "" "http://localhost:9100/docs/no_login.html"
exit /b