@echo off
rem ROLLBACK for Phase 2: makes the exact pre-Preview release (files + config of version cffdea371d499598) live again.
rem Hosting only. Touches no Functions, rules or data.
setlocal
cd /d "%~dp0.."
if not exist tmp\deploy mkdir tmp\deploy
set "LOG=tmp\deploy\hosting-rollback.log"
echo Zelvero Hosting rollback to cffdea371d499598 - writing %LOG% ...
echo === started %date% %time% > "%LOG%"
call npx firebase-tools hosting:clone zelvoropos@cffdea371d499598 zelvoropos:live --project zelvoropos >> "%LOG%" 2>&1
echo === EXIT rollback %errorlevel% >> "%LOG%"
call npx firebase-tools hosting:channel:list --project zelvoropos --site zelvoropos --json > tmp\deploy\hosting-postrollback.json 2>> "%LOG%"
echo === finished %date% %time% >> "%LOG%"
echo Finished. You can close this window.
endlocal
