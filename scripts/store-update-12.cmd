@echo off
rem Run only with the owner's approval: commits and deploys ONLY the new function keepStoresWarm
rem (every 10 minutes it wakes the shop page and catalogue servers so the first visitor after a
rem quiet spell doesn't wait ~3 s more). No Hosting, no other function.
setlocal
cd /d "%~dp0.."
if not exist tmp\deploy\store mkdir tmp\deploy\store
set "LOG=tmp\deploy\store\update-12.log"
echo === started %date% %time% > "%LOG%"
git add -A -- functions/src/keepWarm.ts functions/src/index.ts scripts/store-update-12.cmd >> "%LOG%" 2>&1
git commit -F tmp\commit-keep-warm.txt >> "%LOG%" 2>&1
echo === EXIT commit %errorlevel% >> "%LOG%"
git log -1 --oneline >> "%LOG%" 2>&1
call npx firebase-tools deploy --only functions:keepStoresWarm --project zelvoropos --non-interactive >> "%LOG%" 2>&1
echo === EXIT functions %errorlevel% >> "%LOG%"
echo === finished %date% %time% >> "%LOG%"
echo Finished. You can close this window.
endlocal
