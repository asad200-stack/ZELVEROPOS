@echo off
rem APPROVED Phase 3 (2026-11-11): deploys ONLY aiCopilotAccess and aiCopilotRead to zelvoropos.
rem No Hosting, no Firestore rules, no other functions. --only with explicit names never deletes or updates other functions.
rem Aborts unless the pre-check listing shows neither function exists yet.
setlocal
cd /d "%~dp0.."
set "OUT=tmp\deploy\ai"
if not exist "%OUT%" mkdir "%OUT%"
set "LOG=%OUT%\deploy.log"
echo Zelvero Phase 3 deploy (2 AI functions only) - writing %LOG% ...
echo === started %date% %time% > "%LOG%"
node -e "const j=JSON.parse(require('fs').readFileSync('tmp/deploy/ai/functions-before.json','utf8').replace(/^﻿/,''));const r=j.result||j;const ids=r.map(f=>f.id);console.log('functions before:',ids.length);process.exit(ids.includes('aiCopilotAccess')||ids.includes('aiCopilotRead')?3:0)" >> "%LOG%" 2>&1
if errorlevel 1 (
  echo === ABORT an AI function already exists in production >> "%LOG%"
  echo ABORTED: see %LOG%. Nothing deployed.
  goto done
)
call npx firebase-tools deploy --only functions:aiCopilotAccess,functions:aiCopilotRead --project zelvoropos --non-interactive >> "%LOG%" 2>&1
echo === EXIT deploy %errorlevel% >> "%LOG%"
call npx firebase-tools functions:list --project zelvoropos --json > "%OUT%\functions-after.json" 2>> "%LOG%"
echo === EXIT functions-list %errorlevel% >> "%LOG%"
call npx firebase-tools hosting:channel:list --project zelvoropos --site zelvoropos --json > "%OUT%\hosting-after.json" 2>> "%LOG%"
echo === EXIT hosting-list %errorlevel% >> "%LOG%"
:done
echo === finished %date% %time% >> "%LOG%"
echo Finished. You can close this window.
endlocal
