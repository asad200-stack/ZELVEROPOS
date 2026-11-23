@echo off
rem APPROVED by the owner (2026-11-23): commits the store-link card, rebuilds the store tree /app/0.9.3/
rem (previous tree files kept so open pages keep loading) and deploys Hosting. The customer root stays
rem byte-identical. Aborts if the live site no longer matches hosting-release\. Hosting only.
setlocal
cd /d "%~dp0.."
if not exist tmp\deploy\store mkdir tmp\deploy\store
set "LOG=tmp\deploy\store\update-4.log"
echo === started %date% %time% > "%LOG%"
git add src/features/onlineStore/StoreLinkCard.tsx src/features/onlineStore/OnlineStoreSettingsPage.tsx src/i18n/ar.ts src/i18n/en.ts src/styles/pages.css scripts/demo-phone-photos.mjs scripts/demo-phone-photos.cmd scripts/store-check-live.mjs scripts/store-update-4.cmd >> "%LOG%" 2>&1
git commit -F tmp\commit-link-card.txt >> "%LOG%" 2>&1
echo === EXIT commit %errorlevel% >> "%LOG%"
call node scripts/store-check-live.mjs >> "%LOG%" 2>&1
if errorlevel 1 (
  echo === ABORT live site changed >> "%LOG%"
  echo ABORTED: the live site changed. Nothing deployed.
  goto done
)
set "STORE_RELEASE_VERSION=0.9.3"
set "ZELVERO_BASE=/app/0.9.3/"
set "VITE_APP_RELEASE_VERSION=0.9.3"
for /f %%i in ('git rev-parse --short HEAD') do set "SHA=%%i"
set "VITE_APP_BUILD_ID=store-0.9.3+%SHA%"
echo === build %VITE_APP_BUILD_ID% >> "%LOG%"
if exist release-tree\assets robocopy release-tree\assets tmp\prev-tree-assets /E /NFL /NDL /NJH /NJS >> "%LOG%" 2>&1
call npx tsc -b --noEmit >> "%LOG%" 2>&1
echo === EXIT typecheck %errorlevel% >> "%LOG%"
if errorlevel 1 goto done
call npx vite build --mode production --outDir release-tree --emptyOutDir >> "%LOG%" 2>&1
echo === EXIT build %errorlevel% >> "%LOG%"
if errorlevel 1 goto done
if exist tmp\prev-tree-assets robocopy tmp\prev-tree-assets release-tree\assets /E /XC /XN /XO /NFL /NDL /NJH /NJS >> "%LOG%" 2>&1
set "STORE_SHARE_PREVIEWS=1"
call node scripts/store-assemble.mjs >> "%LOG%" 2>&1
echo === EXIT assemble %errorlevel% >> "%LOG%"
if errorlevel 1 goto done
call npx firebase-tools deploy --only hosting --config firebase.store-release.json --project zelvoropos --non-interactive -m "0.9.3 tree: store link card after publishing" >> "%LOG%" 2>&1
echo === EXIT deploy %errorlevel% >> "%LOG%"
:done
echo === finished %date% %time% >> "%LOG%"
echo Finished. You can close this window.
endlocal
