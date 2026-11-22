@echo off
rem APPROVED by the owner (2026-11-22): publishes dist\ (release 0.9.3-store.1) to the PREVIEW CHANNEL
rem "store-093" of the zelvoropos site for 30 days. The live site zelvoropos.web.app is NOT changed.
setlocal
cd /d "%~dp0.."
if not exist tmp\deploy\store mkdir tmp\deploy\store
set "LOG=tmp\deploy\store\channel-deploy.log"
echo === started %date% %time% > "%LOG%"
if not exist dist\index.html (
  echo === ABORT dist\index.html missing, run scripts\store-preview-build.cmd first >> "%LOG%"
  echo ABORTED: build first. Nothing deployed.
  goto done
)
call npx firebase-tools hosting:channel:deploy store-093 --only production --expires 30d --project zelvoropos --non-interactive --json > tmp\deploy\store\channel-result.json 2>> "%LOG%"
echo === EXIT channel-deploy %errorlevel% >> "%LOG%"
call npx firebase-tools hosting:channel:list --project zelvoropos --site zelvoropos --json > tmp\deploy\store\hosting-after.json 2>> "%LOG%"
:done
echo === finished %date% %time% >> "%LOG%"
echo Finished. You can close this window.
endlocal
