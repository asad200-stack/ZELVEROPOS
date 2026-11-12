@echo off
rem APPROVED (2026-11-12): deploys ONLY hosting-deliverable/ (unchanged customer root + app/0.9.1-admin.1 +
rem new app/0.9.2-ai.1) to zelvoropos Hosting using firebase.preview-hosting.ai.json. Hosting only: no
rem functions, no rules. Aborts if live Hosting version is no longer 5ecce9acdad607af.
setlocal
cd /d "%~dp0.."
if not exist tmp\deploy mkdir tmp\deploy
set "LOG=tmp\deploy\ai-hosting-deploy.log"
echo === started %date% %time% > "%LOG%"
call npx firebase-tools hosting:channel:list --project zelvoropos --site zelvoropos --json > tmp\deploy\ai-hosting-deploy-check.json 2>> "%LOG%"
findstr /c:"5ecce9acdad607af" tmp\deploy\ai-hosting-deploy-check.json > nul
if errorlevel 1 (
  echo === ABORT live Hosting version is not 5ecce9acdad607af >> "%LOG%"
  echo ABORTED: live Hosting changed since verification. Nothing deployed.
  goto done
)
call npx firebase-tools deploy --only hosting --config firebase.preview-hosting.ai.json --project zelvoropos --non-interactive -m "AI Preview 0.9.2-ai.1 added; 0.9.1-admin.1 and customer root unchanged" >> "%LOG%" 2>&1
echo === EXIT deploy %errorlevel% >> "%LOG%"
call npx firebase-tools hosting:channel:list --project zelvoropos --site zelvoropos --json > tmp\deploy\ai-hosting-deploy-after.json 2>> "%LOG%"
:done
echo === finished %date% %time% >> "%LOG%"
echo Finished. You can close this window.
endlocal
