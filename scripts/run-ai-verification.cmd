@echo off
rem LOCAL ONLY: full unit suite + AI/Preview/release emulator tests on demo-zelvero. Never deploys.
setlocal
cd /d "%~dp0.."
set "JDK=C:\Program Files\Eclipse Adoptium\jdk-25.0.2.10-hotspot"
set "LOG=tmp\ai-verification.log"
set "SKIP_UNIT=1"
if not exist tmp mkdir tmp
set "JAVA_HOME=%JDK%"
set "PATH=%JDK%\bin;%PATH%"
set "CLOUDSDK_CORE_DISABLE_PROMPTS=1"
set "FUNCTIONS_DISCOVERY_TIMEOUT=90"
echo Zelvero AI verification - writing %LOG% ...
echo === started %date% %time% > "%LOG%"
echo === STEP unit >> "%LOG%"
if "%SKIP_UNIT%"=="" call npx vitest run >> "%LOG%" 2>&1
echo === EXIT unit %errorlevel% >> "%LOG%"
echo === STEP guard >> "%LOG%"
node scripts\firebase-guard.mjs --emulator --project=demo-zelvero >> "%LOG%" 2>&1
echo === EXIT guard %errorlevel% >> "%LOG%"
if errorlevel 1 goto done
echo === STEP functions-build >> "%LOG%"
call npm --prefix functions run build >> "%LOG%" 2>&1
echo === EXIT functions-build %errorlevel% >> "%LOG%"
if errorlevel 1 goto done
echo === STEP emulator >> "%LOG%"
call npx firebase-tools emulators:exec --only auth,firestore,functions,storage --project demo-zelvero "npx vitest run --config vitest.integration.config.ts tests/integration/ai-copilot-access.test.ts tests/integration/release-ai-draft.test.ts tests/integration/preview-access.test.ts tests/integration/tenant-isolation.test.ts" >> "%LOG%" 2>&1
echo === EXIT emulator %errorlevel% >> "%LOG%"
:done
echo === finished %date% %time% >> "%LOG%"
echo Finished. You can close this window.
endlocal
