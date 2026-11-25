@echo off
rem Run only with the owner's approval: Zelvero POS 1.0.0 for every store.
rem 1) adds /app/1.0.0/ next to the live site (nothing moves yet)  2) store pages use the 1.0.0 shell
rem 3) the root app and /app/0.9.3/ open the same screen under /app/1.0.0/. Each step is checked live; any failure stops.
setlocal
cd /d "%~dp0.."
if not exist tmp\deploy\store mkdir tmp\deploy\store
set "LOG=tmp\deploy\store\update-21.log"
echo === started %date% %time% > "%LOG%"
call node scripts/store-check-live.mjs >> "%LOG%" 2>&1
if errorlevel 1 (
  echo === ABORT live site changed >> "%LOG%"
  echo ABORTED: the live site changed. Nothing was deployed.
  goto done
)
if not exist tmp\legacy-trees\app\0.9.3\index.html robocopy hosting-release\app\0.9.3 tmp\legacy-trees\app\0.9.3 /E /NFL /NDL /NJH /NJS >> "%LOG%" 2>&1
findstr /C:"/app/0.9.3/assets/" tmp\legacy-trees\app\0.9.3\index.html >nul
if errorlevel 1 (
  echo === ABORT no copy of the 0.9.3 tree >> "%LOG%"
  echo ABORTED: could not keep a copy of the 0.9.3 tree. Nothing was deployed.
  goto done
)
echo === EXIT snapshot 0 >> "%LOG%"
git add -A -- src functions/src/keepWarm.ts functions/scripts/check-regions.mjs scripts/zz-keepwarm.cmd scripts/store-update-20.cmd scripts/store-update-21.cmd scripts/store-assemble.mjs scripts/store-check-live.mjs scripts/store-verify-100.mjs package.json package-lock.json >> "%LOG%" 2>&1
git commit -F tmp\commit-100.txt >> "%LOG%" 2>&1
echo === EXIT commit %errorlevel% >> "%LOG%"
git log -1 --oneline >> "%LOG%" 2>&1
set "STORE_RELEASE_VERSION=1.0.0"
set "ZELVERO_BASE=/app/1.0.0/"
set "VITE_APP_RELEASE_VERSION=1.0.0"
for /f %%i in ('git rev-parse --short HEAD') do set "SHA=%%i"
set "VITE_APP_BUILD_ID=1.0.0+%SHA%"
echo === build %VITE_APP_BUILD_ID% >> "%LOG%"
call npx tsc -b --noEmit >> "%LOG%" 2>&1
echo === EXIT typecheck %errorlevel% >> "%LOG%"
if errorlevel 1 goto done
call npx vite build --mode production --outDir release-tree --emptyOutDir >> "%LOG%" 2>&1
echo === EXIT build %errorlevel% >> "%LOG%"
if errorlevel 1 goto done
set "STORE_SHARE_PREVIEWS=1"
set "STORE_IMAGES=1"
set "STORE_LEGACY_TREES=0.9.3"
set "STORE_MOVE_ALL="
call node scripts/store-assemble.mjs >> "%LOG%" 2>&1
echo === EXIT assemble-tree %errorlevel% >> "%LOG%"
if errorlevel 1 goto done
call npx firebase-tools deploy --only hosting --config firebase.store-release.json --project zelvoropos --non-interactive -m "1.0.0 tree added (nothing moved yet)" >> "%LOG%" 2>&1
echo === EXIT deploy-tree %errorlevel% >> "%LOG%"
if errorlevel 1 goto done
call node scripts/store-verify-100.mjs tree >> "%LOG%" 2>&1
echo === EXIT verify-tree %errorlevel% >> "%LOG%"
if errorlevel 1 goto done
call npx firebase-tools deploy --only functions:publicStorePage --project zelvoropos --non-interactive >> "%LOG%" 2>&1
echo === EXIT functions %errorlevel% >> "%LOG%"
if errorlevel 1 goto done
call node scripts/store-verify-100.mjs shell >> "%LOG%" 2>&1
echo === EXIT verify-shell %errorlevel% >> "%LOG%"
if errorlevel 1 goto done
set "STORE_MOVE_ALL=1"
call node scripts/store-assemble.mjs >> "%LOG%" 2>&1
echo === EXIT assemble-move %errorlevel% >> "%LOG%"
if errorlevel 1 goto done
call npx firebase-tools deploy --only hosting --config firebase.store-release.json --project zelvoropos --non-interactive -m "1.0.0 for every store" >> "%LOG%" 2>&1
echo === EXIT deploy-move %errorlevel% >> "%LOG%"
if errorlevel 1 goto done
call node scripts/store-verify-100.mjs move >> "%LOG%" 2>&1
echo === EXIT verify-move %errorlevel% >> "%LOG%"
call node scripts/store-check-live.mjs >> "%LOG%" 2>&1
echo === EXIT check-live %errorlevel% >> "%LOG%"
:done
echo === finished %date% %time% >> "%LOG%"
echo Finished. You can close this window.
endlocal
