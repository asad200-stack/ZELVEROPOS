@echo off
rem LOCAL ONLY: installs sharp for the photo server (functions), then runs the unit tests and the
rem functions typecheck. Nothing is deployed.
cd /d "%~dp0.."
if not exist tmp mkdir tmp
set "LOG=tmp\prepare-13.log"
echo === started %date% %time% > "%LOG%"
call npm --prefix functions install --save-exact sharp@0.33.5 >> "%LOG%" 2>&1
echo === EXIT sharp %errorlevel% >> "%LOG%"
call npm --prefix functions run typecheck >> "%LOG%" 2>&1
echo === EXIT fn-typecheck %errorlevel% >> "%LOG%"
call npx vitest run >> "%LOG%" 2>&1
echo === EXIT tests %errorlevel% >> "%LOG%"
echo === finished %date% %time% >> "%LOG%"
