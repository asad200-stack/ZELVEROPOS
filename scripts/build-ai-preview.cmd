@echo off
rem LOCAL ONLY: builds the Super Admin AI Preview bundle into preview-ai-dist\ (never dist\). Deploys nothing.
setlocal
cd /d "%~dp0.."
if not exist tmp mkdir tmp
set "LOG=tmp\build-ai-preview.log"
set "ZELVERO_BASE=/app/0.9.2-ai.1/"
set "VITE_ADMIN_PREVIEW=true"
set "VITE_APP_RELEASE_VERSION=0.9.2-ai.1"
set "VITE_APP_BUILD_ID=ai-1.0-preview-1+4344100"
echo Zelvero AI Preview build 0.9.2-ai.1 - writing %LOG% ...
echo === started %date% %time% > "%LOG%"
call npx tsc -b --noEmit >> "%LOG%" 2>&1
echo === EXIT typecheck %errorlevel% >> "%LOG%"
if errorlevel 1 goto done
call npx vite build --mode production --outDir preview-ai-dist --emptyOutDir >> "%LOG%" 2>&1
echo === EXIT build %errorlevel% >> "%LOG%"
:done
echo === finished %date% %time% >> "%LOG%"
echo Finished. You can close this window.
endlocal
