@echo off
rem APPROVED by the owner (2026-11-22): updates ONLY the 10 Feature Center functions so the Online Store 1.0
rem can be released per store from Super Admin. The only change for them is the online_store definition
rem (ready for customers, version 1.0.0). No Hosting, no rules, no other functions.
setlocal
cd /d "%~dp0.."
if not exist tmp\deploy\store mkdir tmp\deploy\store
set "LOG=tmp\deploy\store\feature-deploy.log"
echo === started %date% %time% > "%LOG%"
call npx firebase-tools deploy --only functions:listFeatureCatalog,functions:markFeatureReady,functions:publishFeature,functions:pauseFeature,functions:rollbackFeature,functions:grantFeaturePurchase,functions:setFeatureKillSwitch,functions:recordFeaturePreview,functions:listMyFeatureUpdates,functions:activateMyFeature --project zelvoropos --non-interactive >> "%LOG%" 2>&1
echo === EXIT deploy %errorlevel% >> "%LOG%"
echo === finished %date% %time% >> "%LOG%"
echo Finished. You can close this window.
endlocal
