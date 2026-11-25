@echo off
rem Run only with the owner's approval: adds two Firestore indexes (online orders and reviews by status). Deletes nothing.
setlocal
cd /d "%~dp0.."
set "LOG=tmp\deploy\store\update-22.log"
echo === started %date% %time% > "%LOG%"
git add -- firestore.indexes.json scripts/store-update-22.cmd >> "%LOG%" 2>&1
git commit -F tmp\commit-101.txt >> "%LOG%" 2>&1
echo === EXIT commit %errorlevel% >> "%LOG%"
call npx firebase-tools deploy --only firestore:indexes --project zelvoropos --non-interactive >> "%LOG%" 2>&1
echo === EXIT indexes %errorlevel% >> "%LOG%"
echo === finished %date% %time% >> "%LOG%"
echo Finished. You can close this window.
endlocal
