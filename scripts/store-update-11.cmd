@echo off
rem Run only with the owner's approval: faster shop websites. They no longer start App Check (every
rem visitor waited ~3 s before the products were requested; the POS keeps it), and the catalogue is
rem requested by boot.js while the app downloads. Commits index.html and public/boot.js too. Rebuilds the store tree
rem /app/0.9.3/ and deploys Hosting only.
setlocal
cd /d "%~dp0.."
if not exist tmp\deploy\store mkdir tmp\deploy\store
set "LOG=tmp\deploy\store\update-11.log"
echo === started %date% %time% > "%LOG%"
git add -A -- src functions/src index.html public/boot.js scripts/store-update-11.cmd >> "%LOG%" 2>&1
git commit -F tmp\commit-store-speed.txt >> "%LOG%" 2>&1
echo === EXIT commit %errorlevel% >> "%LOG%"
git log -1 --oneline >> "%LOG%" 2>&1
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
call npx firebase-tools deploy --only hosting --config firebase.store-release.json --project zelvoropos --non-interactive -m "0.9.3 tree: faster shop websites" >> "%LOG%" 2>&1
echo === EXIT deploy %errorlevel% >> "%LOG%"
:done
echo === finished %date% %time% >> "%LOG%"
echo Finished. You can close this window.
endlocal
