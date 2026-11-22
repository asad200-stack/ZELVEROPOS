@echo off
rem READ-ONLY (2026-11-22): lists deployed functions and Hosting channels on zelvoropos before the
rem online-store Super Admin release. Deploys nothing and changes nothing.
setlocal
cd /d "%~dp0.."
if not exist tmp\deploy\store mkdir tmp\deploy\store
set "LOG=tmp\deploy\store\precheck.log"
echo === started %date% %time% > "%LOG%"
call npx firebase-tools functions:list --project zelvoropos --json > tmp\deploy\store\functions-before.json 2>> "%LOG%"
echo === EXIT functions-list %errorlevel% >> "%LOG%"
call npx firebase-tools hosting:channel:list --project zelvoropos --site zelvoropos --json > tmp\deploy\store\hosting-before.json 2>> "%LOG%"
echo === EXIT hosting-list %errorlevel% >> "%LOG%"
echo === finished %date% %time% >> "%LOG%"
echo Finished. You can close this window.
endlocal
