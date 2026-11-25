@echo off
rem Re-deploys ONLY keepStoresWarm with --debug to see why Cloud Scheduler refuses the job (approved: update-19).
cd /d "%~dp0.."
set "LOG=tmp\deploy\store\keepwarm-debug.log"
echo === started %date% %time% > "%LOG%"
call npx firebase-tools deploy --only functions:keepStoresWarm --project zelvoropos --non-interactive --debug >> "%LOG%" 2>&1
echo === EXIT keepwarm %errorlevel% >> "%LOG%"
echo Finished. You can close this window.
