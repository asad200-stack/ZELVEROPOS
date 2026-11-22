@echo off
rem LOCAL ONLY (2026-11-22): builds release 0.9.3-store.1 into dist\ for the Super Admin preview channel. Deploys nothing.
setlocal
cd /d "%~dp0.."
if not exist tmp\deploy\store mkdir tmp\deploy\store
set "LOG=tmp\deploy\store\build.log"
set "VITE_APP_RELEASE_VERSION=0.9.3-store.1"
for /f %%i in ('git rev-parse --short HEAD') do set "SHA=%%i"
set "VITE_APP_BUILD_ID=store-0.9.3-preview-1+%SHA%"
echo === started %date% %time% build %VITE_APP_BUILD_ID% > "%LOG%"
call npm run build >> "%LOG%" 2>&1
echo === EXIT build %errorlevel% >> "%LOG%"
echo === finished %date% %time% >> "%LOG%"
echo Finished. You can close this window.
endlocal
