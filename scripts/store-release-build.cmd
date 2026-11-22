@echo off
rem LOCAL ONLY (2026-11-22): copies the live customer site (read-only), builds release 0.9.3 as the
rem versioned tree /app/0.9.3/ and assembles hosting-release\. Deploys nothing.
setlocal
cd /d "%~dp0.."
if not exist tmp\deploy\store mkdir tmp\deploy\store
set "LOG=tmp\deploy\store\release-build.log"
set "STORE_RELEASE_VERSION=0.9.3"
set "ZELVERO_BASE=/app/0.9.3/"
set "VITE_APP_RELEASE_VERSION=0.9.3"
for /f %%i in ('git rev-parse --short HEAD') do set "SHA=%%i"
set "VITE_APP_BUILD_ID=store-0.9.3+%SHA%"
echo === started %date% %time% %VITE_APP_BUILD_ID% > "%LOG%"
echo Copying the live site ...
call node scripts/store-mirror-live.mjs >> "%LOG%" 2>&1
echo === EXIT mirror %errorlevel% >> "%LOG%"
if errorlevel 1 goto done
echo Building 0.9.3 ...
call npx tsc -b --noEmit >> "%LOG%" 2>&1
echo === EXIT typecheck %errorlevel% >> "%LOG%"
if errorlevel 1 goto done
call npx vite build --mode production --outDir release-tree --emptyOutDir >> "%LOG%" 2>&1
echo === EXIT build %errorlevel% >> "%LOG%"
if errorlevel 1 goto done
call node scripts/store-assemble.mjs >> "%LOG%" 2>&1
echo === EXIT assemble %errorlevel% >> "%LOG%"
:done
echo === finished %date% %time% >> "%LOG%"
echo Finished. You can close this window.
endlocal
