@echo off
rem APPROVED by the owner (2026-11-22): deploys ONLY the 29 NEW online-store / sizes functions to zelvoropos,
rem in 4 small batches (a single big deploy hit the per-minute quota before). None of them exists in production
rem yet (see tmp\deploy\store\functions-before.json), so no running function changes. No Hosting, no rules.
setlocal
cd /d "%~dp0.."
if not exist tmp\deploy\store mkdir tmp\deploy\store
set "LOG=tmp\deploy\store\functions-deploy.log"
echo === started %date% %time% > "%LOG%"
echo Batch 1 of 4 ...
echo === batch 1: onlineStoreGetConfig onlineStoreSaveDraft onlineStoreSetSlug onlineStorePublish onlineStoreUnpublish onlineStoreSetProductVisibility onlineStoreSaveListing onlineStoreStats >> "%LOG%"
call npx firebase-tools deploy --only functions:onlineStoreGetConfig,functions:onlineStoreSaveDraft,functions:onlineStoreSetSlug,functions:onlineStorePublish,functions:onlineStoreUnpublish,functions:onlineStoreSetProductVisibility,functions:onlineStoreSaveListing,functions:onlineStoreStats --project zelvoropos --non-interactive >> "%LOG%" 2>&1
echo === EXIT batch 1 %errorlevel% >> "%LOG%"
echo Waiting 75 seconds for the Cloud Functions quota ...
timeout /t 75 /nobreak > nul
echo Batch 2 of 4 ...
echo === batch 2: onlineStoreSetDomain publicStoreByDomain publicStoreCatalog publicStorePage publicTrackEvent onlineStoreGetPayments onlineStoreSetWhish >> "%LOG%"
call npx firebase-tools deploy --only functions:onlineStoreSetDomain,functions:publicStoreByDomain,functions:publicStoreCatalog,functions:publicStorePage,functions:publicTrackEvent,functions:onlineStoreGetPayments,functions:onlineStoreSetWhish --project zelvoropos --non-interactive >> "%LOG%" 2>&1
echo === EXIT batch 2 %errorlevel% >> "%LOG%"
echo Waiting 75 seconds for the Cloud Functions quota ...
timeout /t 75 /nobreak > nul
echo Batch 3 of 4 ...
echo === batch 3: publicPlaceOrder publicTrackOrder publicProductReviews publicSubmitReview onlineOrdersList onlineOrdersSetStatus onlineReviewsList >> "%LOG%"
call npx firebase-tools deploy --only functions:publicPlaceOrder,functions:publicTrackOrder,functions:publicProductReviews,functions:publicSubmitReview,functions:onlineOrdersList,functions:onlineOrdersSetStatus,functions:onlineReviewsList --project zelvoropos --non-interactive >> "%LOG%" 2>&1
echo === EXIT batch 3 %errorlevel% >> "%LOG%"
echo Waiting 75 seconds for the Cloud Functions quota ...
timeout /t 75 /nobreak > nul
echo Batch 4 of 4 ...
echo === batch 4: onlineReviewsSetStatus publicPayOrder publicCheckPayment onlineOrdersCheckPayment whishCallback posCreateProductGroup posAddProductOptions >> "%LOG%"
call npx firebase-tools deploy --only functions:onlineReviewsSetStatus,functions:publicPayOrder,functions:publicCheckPayment,functions:onlineOrdersCheckPayment,functions:whishCallback,functions:posCreateProductGroup,functions:posAddProductOptions --project zelvoropos --non-interactive >> "%LOG%" 2>&1
echo === EXIT batch 4 %errorlevel% >> "%LOG%"
call npx firebase-tools functions:list --project zelvoropos --json > tmp\deploy\store\functions-after.json 2>> "%LOG%"
echo === EXIT functions-list %errorlevel% >> "%LOG%"
echo === finished %date% %time% >> "%LOG%"
echo Finished. You can close this window.
endlocal
