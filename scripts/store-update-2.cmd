@echo off
rem APPROVED by the owner (2026-11-23 "okay yala"): rebuilds the store tree /app/0.9.3/ with the new
rem features (previous tree files kept so open pages keep loading), points /s/** at publicStorePage only if
rem it already serves the tree, and deploys Hosting. The customer root stays byte-identical. Aborts if the
rem live version is no longer 16542c9b6ea14366. Hosting only.
setlocal
cd /d "%~dp0.."
if not exist tmp\deploy\store mkdir tmp\deploy\store
set "LOG=tmp\deploy\store\update-2.log"
set "STORE_RELEASE_VERSION=0.9.3"
set "ZELVERO_BASE=/app/0.9.3/"
set "VITE_APP_RELEASE_VERSION=0.9.3"
for /f %%i in ('git rev-parse --short HEAD') do set "SHA=%%i"
set "VITE_APP_BUILD_ID=store-0.9.3+%SHA%"
echo === started %date% %time% %VITE_APP_BUILD_ID% > "%LOG%"
call npx firebase-tools hosting:channel:list --project zelvoropos --site zelvoropos --json > tmp\deploy\store\update-2-before.json 2>> "%LOG%"
findstr /c:"16542c9b6ea14366" tmp\deploy\store\update-2-before.json > nul
if errorlevel 1 (
  echo === ABORT live Hosting version is not 16542c9b6ea14366 >> "%LOG%"
  echo ABORTED: the live site changed. Nothing deployed.
  goto done
)
if not exist hosting-live\index.html (
  echo === ABORT hosting-live copy missing >> "%LOG%"
  goto done
)
if exist release-tree\assets robocopy release-tree\assets tmp\prev-tree-assets /E /NFL /NDL /NJH /NJS >> "%LOG%" 2>&1
call npx tsc -b --noEmit >> "%LOG%" 2>&1
echo === EXIT typecheck %errorlevel% >> "%LOG%"
if errorlevel 1 goto done
call npx vite build --mode production --outDir release-tree --emptyOutDir >> "%LOG%" 2>&1
echo === EXIT build %errorlevel% >> "%LOG%"
if errorlevel 1 goto done
if exist tmp\prev-tree-assets robocopy tmp\prev-tree-assets release-tree\assets /E /XC /XN /XO /NFL /NDL /NJH /NJS >> "%LOG%" 2>&1
set "STORE_SHARE_PREVIEWS=0"
call node scripts/store-check-share.mjs >> "%LOG%" 2>&1
if not errorlevel 1 set "STORE_SHARE_PREVIEWS=1"
echo === share previews %STORE_SHARE_PREVIEWS% >> "%LOG%"
call node scripts/store-assemble.mjs >> "%LOG%" 2>&1
echo === EXIT assemble %errorlevel% >> "%LOG%"
if errorlevel 1 goto done
call npx firebase-tools deploy --only hosting --config firebase.store-release.json --project zelvoropos --non-interactive -m "0.9.3 tree: colour photos, gallery, Whish waits for payment, order alerts, store report" >> "%LOG%" 2>&1
echo === EXIT deploy %errorlevel% >> "%LOG%"
call npx firebase-tools hosting:channel:list --project zelvoropos --site zelvoropos --json > tmp\deploy\store\update-2-after.json 2>> "%LOG%"
:done
echo === finished %date% %time% >> "%LOG%"
echo Finished. You can close this window.
endlocal
