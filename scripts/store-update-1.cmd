@echo off
rem APPROVED by the owner (2026-11-23 "okay yala"): commits the store improvements, then deploys
rem Firestore rules (products.gallery) and ONLY these 8 functions. No Hosting.
setlocal
cd /d "%~dp0.."
if not exist tmp\deploy\store mkdir tmp\deploy\store
set "LOG=tmp\deploy\store\update-1.log"
echo === started %date% %time% > "%LOG%"
git add config/firestore.rules firestore.rules functions/scripts/copy-shared.mjs functions/src scripts/store-assemble.mjs scripts/check-store-improvements.cmd scripts/store-update-1.cmd scripts/store-update-2.cmd scripts/store-check-share.mjs src >> "%LOG%" 2>&1
git commit -F tmp\commit-improvements.txt >> "%LOG%" 2>&1
echo === EXIT commit %errorlevel% >> "%LOG%"
git log -1 --oneline >> "%LOG%" 2>&1
call npx firebase-tools deploy --only firestore:rules --project zelvoropos --non-interactive >> "%LOG%" 2>&1
echo === EXIT rules %errorlevel% >> "%LOG%"
if errorlevel 1 goto done
call npx firebase-tools deploy --only functions:posAddProductOptions,functions:posDeleteProduct,functions:onlineOrdersSetStatus,functions:onlineOrdersSettlePayment,functions:onlineStoreStats,functions:publicStoreCatalog,functions:onlineStoreGetConfig,functions:publicStorePage --project zelvoropos --non-interactive >> "%LOG%" 2>&1
echo === EXIT functions %errorlevel% >> "%LOG%"
:done
echo === finished %date% %time% >> "%LOG%"
echo Finished. You can close this window.
endlocal
