@echo off
rem LOCAL ONLY: runs the full unit test suite (incl. Zelvero AI copilot tests). No Firebase, no deploy.
setlocal
cd /d "%~dp0.."
if not exist tmp mkdir tmp
set "LOG=tmp\ai-tests.log"
echo Zelvero unit tests - writing %LOG% ...
echo === started %date% %time% > "%LOG%"
call npx vitest run --reporter=default >> "%LOG%" 2>&1
echo === EXIT vitest %errorlevel% >> "%LOG%"
echo === finished %date% %time% >> "%LOG%"
echo Finished. You can close this window.
endlocal
