@echo off
rem LOCAL ONLY: tests, typecheck and builds for the store improvements. Deploys nothing.
setlocal
cd /d "%~dp0.."
if not exist tmp\deploy\store mkdir tmp\deploy\store
set "LOG=tmp\deploy\store\check-improvements.log"
echo === started %date% %time% > "%LOG%"
call npx vitest run >> "%LOG%" 2>&1
echo === EXIT vitest %errorlevel% >> "%LOG%"
call npm run typecheck >> "%LOG%" 2>&1
echo === EXIT typecheck %errorlevel% >> "%LOG%"
call npm run functions:build >> "%LOG%" 2>&1
echo === EXIT functions-build %errorlevel% >> "%LOG%"
echo === finished %date% %time% >> "%LOG%"
echo Finished. You can close this window.
endlocal
