@echo off
rem READ-ONLY: reports whether the platform Super Admin(s) already have the internal demo store. Writes nothing to Firebase.
setlocal
cd /d "%~dp0.."
if not exist tmp\deploy mkdir tmp\deploy
set "LOG=tmp\deploy\internal-demo-status.log"
echo Zelvero internal demo status (read-only) - writing %LOG% ...
echo === started %date% %time% > "%LOG%"
call npx -y -p firebase-tools@15.19.1 -c "node scripts/internal-demo-status.cjs" >> "%LOG%" 2>&1
echo === EXIT status %errorlevel% >> "%LOG%"
echo === finished %date% %time% >> "%LOG%"
echo Finished. You can close this window.
endlocal
