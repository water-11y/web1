@echo off
cd /d D:\web1\server
curl.exe -s --max-time 2 http://127.0.0.1:3000/api/apps/demo >nul 2>nul
if %ERRORLEVEL%==0 (
  echo Web1 config server is already running on port 3000.
  echo You can now press RETRY in the Android app.
  pause
  exit /b 0
)
echo Web1 config server is starting...
echo Keep this window open while testing the Android app.
node server.js
pause
