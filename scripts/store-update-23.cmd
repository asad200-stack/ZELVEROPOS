@echo off
rem Run only with the owner's approval: production frozen at 1.0.0 (createRelease + the 1.0.0 tree, old chunks kept).
setlocal
cd /d "%~dp0.."
set "LOG=tmp\deploy\store\update-23.log"
echo === started %date% %time% > "%LOG%"
call node scripts/store-check-live.mjs >> "%LOG%" 2>&1
if errorlevel 1 (
  echo === ABORT live site changed >> "%LOG%"
  echo ABORTED: the live site changed. Nothing was deployed.
  goto done
)
git add -A -- src functions/src/shared/release.ts scripts/store-update-23.cmd >> "%LOG%" 2>&1
git commit -F tmp\commit-102.txt >> "%LOG%" 2>&1
echo === EXIT commit %errorlevel% >> "%LOG%"
call npx firebase-tools deploy --only functions:createRelease --project zelvoropos --non-interactive >> "%LOG%" 2>&1
echo === EXIT functions %errorlevel% >> "%LOG%"
if errorlevel 1 goto done
set "STORE_RELEASE_VERSION=1.0.0"
set "ZELVERO_BASE=/app/1.0.0/"
set "VITE_APP_RELEASE_VERSION=1.0.0"
for /f %%i in ('git rev-parse --short HEAD') do set "SHA=%%i"
set "VITE_APP_BUILD_ID=1.0.0+%SHA%"
echo === build %VITE_APP_BUILD_ID% >> "%LOG%"
if exist tmp\prev-100-assets rmdir /s /q tmp\prev-100-assets
robocopy release-tree\assets tmp\prev-100-assets /E /NFL /NDL /NJH /NJS >> "%LOG%" 2>&1
call npx tsc -b --noEmit >> "%LOG%" 2>&1
echo === EXIT typecheck %errorlevel% >> "%LOG%"
if errorlevel 1 goto done
call npx vite build --mode production --outDir release-tree --emptyOutDir >> "%LOG%" 2>&1
echo === EXIT build %errorlevel% >> "%LOG%"
if errorlevel 1 goto done
robocopy tmp\prev-100-assets release-tree\assets /E /XC /XN /XO /NFL /NDL /NJH /NJS >> "%LOG%" 2>&1
set "STORE_SHARE_PREVIEWS=1"
set "STORE_IMAGES=1"
set "STORE_LEGACY_TREES=0.9.3"
set "STORE_MOVE_ALL=1"
call node scripts/store-assemble.mjs >> "%LOG%" 2>&1
echo === EXIT assemble %errorlevel% >> "%LOG%"
if errorlevel 1 goto done
call npx firebase-tools deploy --only hosting --config firebase.store-release.json --project zelvoropos --non-interactive -m "1.0.0: production frozen" >> "%LOG%" 2>&1
echo === EXIT deploy %errorlevel% >> "%LOG%"
if errorlevel 1 goto done
call node scripts/store-verify-100.mjs move >> "%LOG%" 2>&1
echo === EXIT verify %errorlevel% >> "%LOG%"
:done
echo === finished %date% %time% >> "%LOG%"
echo Finished. You can close this window.
endlocal
