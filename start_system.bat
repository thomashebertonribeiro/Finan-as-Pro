@echo off
echo ==========================================
echo Starting Finanças Pro System...
echo ==========================================

:: Kill existing node processes to avoid port conflicts
taskkill /F /IM node.exe /T >nul 2>&1

:: Start Backend
start cmd /k "echo Starting Backend... && cd server && node index.js"

:: Start Frontend
start cmd /k "echo Starting Frontend... && cd client && npm run dev"

echo ==========================================
echo Services are starting in separate windows.
echo Dashboard: http://localhost:5173
echo ==========================================
pause
