@echo off
rem APPROVED by the owner (2026-11-23): internal demo store photos. Downloads Pexels photos into
rem hosting-release\app\0.9.3\demo-img\ and redeploys the SAME hosting-release (root and tree unchanged,
rem only the demo-img files are new). Aborts unless the live version is 73b5cd2854d4c6a7. Hosting only.
setlocal
cd /d "%~dp0.."
if not exist tmp\deploy\store mkdir tmp\deploy\store
set "LOG=tmp\deploy\store\demo-photos.log"
echo === started %date% %time% > "%LOG%"
call npx firebase-tools hosting:channel:list --project zelvoropos --site zelvoropos --json > tmp\deploy\store\demo-photos-before.json 2>> "%LOG%"
findstr /c:"73b5cd2854d4c6a7" tmp\deploy\store\demo-photos-before.json > nul
if errorlevel 1 (
  echo === ABORT live Hosting version is not 73b5cd2854d4c6a7 >> "%LOG%"
  echo ABORTED: the live site changed. Nothing deployed.
  goto done
)
call node scripts/demo-phone-photos.mjs >> "%LOG%" 2>&1
echo === EXIT photos %errorlevel% >> "%LOG%"
if errorlevel 1 goto done
call npx firebase-tools deploy --only hosting --config firebase.store-release.json --project zelvoropos --non-interactive -m "demo store photos (demo-img)" >> "%LOG%" 2>&1
echo === EXIT deploy %errorlevel% >> "%LOG%"
:done
echo === finished %date% %time% >> "%LOG%"
echo Finished. You can close this window.
endlocal
