@echo off
rem LOCAL ONLY: serves hosting-deliverable with firebase.preview-hosting.json in the Hosting emulator and checks routes. Deploys nothing.
setlocal
cd /d "%~dp0.."
if not exist tmp\deploy mkdir tmp\deploy
set "LOG=tmp\deploy\hosting-localcheck.log"
echo Zelvero Phase 2 local Hosting check - writing %LOG% ...
echo === started %date% %time% > "%LOG%"
call npx firebase-tools emulators:exec --only hosting --config firebase.preview-hosting.local.json --project demo-zelvero "node scripts/verify-preview-hosting.mjs" >> "%LOG%" 2>&1
echo === EXIT localcheck %errorlevel% >> "%LOG%"
echo === finished %date% %time% >> "%LOG%"
echo Finished. You can close this window.
endlocal
