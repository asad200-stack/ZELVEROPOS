@echo off
rem APPROVED by the owner (2026-11-22): publishes hosting-release\ to the LIVE zelvoropos site:
rem the customer root is the copy of the live site (only boot.js + release.json differ) + the tree /app/0.9.3/.
rem Customers stay on their current app until the Super Admin assigns 0.9.3 in Release Management.
rem Aborts if the live version is no longer 104c0c03df0a2bd7. Hosting only: no functions, no rules.
setlocal
cd /d "%~dp0.."
if not exist tmp\deploy\store mkdir tmp\deploy\store
set "LOG=tmp\deploy\store\release-deploy.log"
echo === started %date% %time% > "%LOG%"
if not exist hosting-release\app\0.9.3\index.html (
  echo === ABORT hosting-release not assembled >> "%LOG%"
  echo ABORTED: run scripts\store-release-build.cmd first. Nothing deployed.
  goto done
)
call npx firebase-tools hosting:channel:list --project zelvoropos --site zelvoropos --json > tmp\deploy\store\release-predeploy.json 2>> "%LOG%"
findstr /c:"104c0c03df0a2bd7" tmp\deploy\store\release-predeploy.json > nul
if errorlevel 1 (
  echo === ABORT live Hosting version is not 104c0c03df0a2bd7 >> "%LOG%"
  echo ABORTED: the live site changed since it was copied. Nothing deployed.
  goto done
)
call npx firebase-tools deploy --only hosting --config firebase.store-release.json --project zelvoropos --non-interactive -m "0.9.3 tree; root unchanged except boot.js follows stores that updated (release.json)" >> "%LOG%" 2>&1
echo === EXIT deploy %errorlevel% >> "%LOG%"
call npx firebase-tools hosting:channel:list --project zelvoropos --site zelvoropos --json > tmp\deploy\store\release-after.json 2>> "%LOG%"
:done
echo === finished %date% %time% >> "%LOG%"
echo Finished. You can close this window.
endlocal
