@echo off
rem FRLcast local app launcher.
rem
rem Double-click this to run FRLcast on your own machine: it starts the broadcast server and
rem opens the operator panel in your browser. Everything works locally here that the hosted
rem site cannot do -- automatic timing, the Piper commentary voice, driver edits -- because
rem this is the full server, not a static page.
rem
rem It uses the Node runtime bundled next to it (runtime\node.exe) when present, so a packaged
rem download needs nothing installed; otherwise it falls back to a system Node.
setlocal
cd /d "%~dp0"

set "NODE=node"
if exist "%~dp0runtime\node.exe" set "NODE=%~dp0runtime\node.exe"

"%NODE%" -v >nul 2>nul
if errorlevel 1 (
  echo.
  echo Node.js was not found. Use the full FRLcast download, which bundles it,
  echo or install Node.js from https://nodejs.org and run this again.
  echo.
  pause
  exit /b 1
)

if not exist "%~dp0node_modules" (
  echo First run: installing dependencies, this happens only once...
  call "%NODE%" "%~dp0node_modules\npm\bin\npm-cli.js" install --omit=dev 2>nul || call npm install --omit=dev
)

echo.
echo Starting FRLcast. The console opens in its own window in a moment.
echo Keep THIS window open during your event. Close it to stop the server.
echo.
rem Open the console as a chromeless app window (Edge/Chrome), a couple of seconds after the
rem server is up. Detached, so this window stays as the running server. Overlays still go into
rem OBS as Browser Sources at http://localhost:4700/overlay/...
start "" powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\open-console.ps1"
"%NODE%" "%~dp0server\index.js"
pause
