@echo off
rem Local-only Preview verification for demo-zelvero. Never deploys. Never uses zelvoropos.
rem Java is set for this window only (same JDK as scripts\start-emulators-local.ps1).
setlocal
cd /d "%~dp0.."
set "JDK=C:\Program Files\Eclipse Adoptium\jdk-25.0.2.10-hotspot"
set "LOG=tmp\preview-verification.log"
if not exist tmp mkdir tmp
if not exist "%JDK%\bin\java.exe" (
  echo JDK 25 not found at %JDK% > "%LOG%"
  echo JDK 25 not found at %JDK%
  goto done
)
set "JAVA_HOME=%JDK%"
set "PATH=%JDK%\bin;%PATH%"
set "CLOUDSDK_CORE_DISABLE_PROMPTS=1"
set "FUNCTIONS_DISCOVERY_TIMEOUT=90"
echo Zelvero Preview verification - writing %LOG% ...
echo === started %date% %time% > "%LOG%"
"%JDK%\bin\java.exe" -version >> "%LOG%" 2>&1

echo === STEP guard >> "%LOG%"
node scripts\firebase-guard.mjs --emulator --project=demo-zelvero >> "%LOG%" 2>&1
echo === EXIT guard %errorlevel% >> "%LOG%"
if errorlevel 1 goto done

echo === STEP unit >> "%LOG%"
call npx vitest run src/domain/adminPreview.test.ts src/domain/previewAccess.test.ts src/domain/previewCenter.test.ts src/domain/release.test.ts src/features/releases src/app/routeAccess.test.ts >> "%LOG%" 2>&1
echo === EXIT unit %errorlevel% >> "%LOG%"

echo === STEP functions-build >> "%LOG%"
call npm --prefix functions run build >> "%LOG%" 2>&1
echo === EXIT functions-build %errorlevel% >> "%LOG%"
if errorlevel 1 goto done

echo === STEP emulator-preview >> "%LOG%"
call npx firebase-tools emulators:exec --only auth,firestore,functions,pubsub,storage --project demo-zelvero "npx vitest run --config vitest.integration.config.ts tests/integration/preview-access.test.ts" >> "%LOG%" 2>&1
echo === EXIT emulator-preview %errorlevel% >> "%LOG%"

:done
echo === finished %date% %time% >> "%LOG%"
echo.
echo Finished. Results are in %LOG%. You can close this window.
endlocal
