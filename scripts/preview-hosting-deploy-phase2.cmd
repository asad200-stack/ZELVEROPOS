@echo off
rem PHASE 2 - NOT YET APPROVED. Deploys hosting-deliverable/ (63 unchanged customer files + /app/0.9.1-admin.1/) to zelvoropos Hosting
rem using firebase.preview-hosting.json. Hosting only: no functions, no rules. Aborts if live is no longer cffdea371d499598.
setlocal
cd /d "%~dp0.."
if not exist tmp\deploy mkdir tmp\deploy
set "LOG=tmp\deploy\hosting-deploy.log"
echo Zelvero Phase 2 Hosting deploy - writing %LOG% ...
echo === started %date% %time% > "%LOG%"
call npx firebase-tools hosting:channel:list --project zelvoropos --site zelvoropos --json > tmp\deploy\hosting-predeploy.json 2>> "%LOG%"
node -e "const j=JSON.parse(require('fs').readFileSync('tmp/deploy/hosting-predeploy.json','utf8').replace(/^﻿/,''));const c=(j.result.channels||j.result).find(x=>x.name.endsWith('/live'));const v=c.release.version.name.split('/').pop();console.log('live version',v);process.exit(v==='cffdea371d499598'?0:3)" >> "%LOG%" 2>&1
if errorlevel 1 (
  echo === ABORT live version is not cffdea371d499598 >> "%LOG%"
  echo ABORTED: live Hosting changed since verification. Nothing deployed.
  goto done
)
call npx firebase-tools deploy --only hosting --config firebase.preview-hosting.json --project zelvoropos --non-interactive -m "Super Admin Preview 0.9.1-admin.1; customer root = files of cffdea371d499598" >> "%LOG%" 2>&1
echo === EXIT deploy %errorlevel% >> "%LOG%"
call npx firebase-tools hosting:channel:list --project zelvoropos --site zelvoropos --json > tmp\deploy\hosting-postdeploy.json 2>> "%LOG%"
:done
echo === finished %date% %time% >> "%LOG%"
echo Finished. You can close this window.
endlocal
