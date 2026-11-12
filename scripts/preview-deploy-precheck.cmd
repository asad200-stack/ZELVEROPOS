@echo off
rem READ-ONLY production pre-checks for the Phase 1 Preview functions deploy. Deploys nothing.
setlocal
cd /d "%~dp0.."
set "OUT=tmp\deploy"
if not exist "%OUT%" mkdir "%OUT%"
set "LOG=%OUT%\precheck.log"
echo Zelvero Phase 1 read-only pre-checks - writing %LOG% ...
echo === started %date% %time% > "%LOG%"
call npx firebase-tools --version >> "%LOG%" 2>&1
echo === EXIT version %errorlevel% >> "%LOG%"
call npx firebase-tools login:list >> "%LOG%" 2>&1
echo === EXIT login %errorlevel% >> "%LOG%"
call npx firebase-tools projects:list --json > "%OUT%\projects.json" 2>> "%LOG%"
echo === EXIT projects %errorlevel% >> "%LOG%"
call npx firebase-tools functions:list --project zelvoropos --json > "%OUT%\functions-before.json" 2>> "%LOG%"
echo === EXIT functions-list %errorlevel% >> "%LOG%"
call npx firebase-tools hosting:channel:list --project zelvoropos --site zelvoropos --json > "%OUT%\hosting-before.json" 2>> "%LOG%"
echo === EXIT hosting-list %errorlevel% >> "%LOG%"
set "GCLOUD_PROJECT=zelvoropos"
node scripts\firebase-guard.mjs --hook >> "%LOG%" 2>&1
echo === EXIT guard %errorlevel% >> "%LOG%"
echo === finished %date% %time% >> "%LOG%"
echo Finished. You can close this window.
endlocal
