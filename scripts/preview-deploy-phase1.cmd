@echo off
rem APPROVED Phase 1 (2026-11-11): deploys ONLY issuePreviewCredential and previewPos to zelvoropos.
rem No Hosting, no Firestore rules, no other functions. Non-interactive: any prompt aborts instead of guessing.
setlocal
cd /d "%~dp0.."
set "OUT=tmp\deploy"
if not exist "%OUT%" mkdir "%OUT%"
set "LOG=%OUT%\deploy.log"
echo Zelvero Phase 1 deploy (2 Preview functions only) - writing %LOG% ...
echo === started %date% %time% > "%LOG%"
call npx firebase-tools deploy --only functions:issuePreviewCredential,functions:previewPos --project zelvoropos --non-interactive >> "%LOG%" 2>&1
echo === EXIT deploy %errorlevel% >> "%LOG%"
call npx firebase-tools functions:list --project zelvoropos --json > "%OUT%\functions-after.json" 2>> "%LOG%"
echo === EXIT functions-list %errorlevel% >> "%LOG%"
call npx firebase-tools hosting:channel:list --project zelvoropos --site zelvoropos --json > "%OUT%\hosting-after.json" 2>> "%LOG%"
echo === EXIT hosting-list %errorlevel% >> "%LOG%"
echo === finished %date% %time% >> "%LOG%"
echo Finished. You can close this window.
endlocal
