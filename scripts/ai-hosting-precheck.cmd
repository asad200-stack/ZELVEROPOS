@echo off
rem READ-ONLY: captures current live Hosting version before the AI Preview hosting deploy. Deploys nothing.
setlocal
cd /d "%~dp0.."
if not exist tmp\deploy mkdir tmp\deploy
set "LOG=tmp\deploy\ai-hosting-precheck.log"
echo === started %date% %time% > "%LOG%"
call npx firebase-tools hosting:channel:list --project zelvoropos --site zelvoropos --json > tmp\deploy\ai-hosting-predeploy.json 2>> "%LOG%"
echo === EXIT list %errorlevel% >> "%LOG%"
node -e "const j=JSON.parse(require('fs').readFileSync('tmp/deploy/ai-hosting-predeploy.json','utf8').replace(/^﻿/,''));const c=(j.result.channels||j.result).find(x=>x.name.endsWith('/live'));console.log('LIVE_VERSION='+c.release.version.name.split('/').pop());console.log('RELEASE_TIME='+c.release.releaseTime);" >> "%LOG%" 2>&1
echo === finished %date% %time% >> "%LOG%"
echo Finished. You can close this window.
endlocal
