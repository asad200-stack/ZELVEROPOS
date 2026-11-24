@echo off
rem Run only with the owner's approval. Commits the Online store work (fitting room, unsaved edits
rem kept between sections, Save and publish, rail price tags, till invoice card; old photo try-on
rem removed), deploys ONLY the 9 named Online store functions, then rebuilds the store tree
rem /app/0.9.3/ (previous files kept so open pages keep loading) and deploys Hosting.
rem Aborts before Hosting if the live site no longer matches hosting-release\.
setlocal
cd /d "%~dp0.."
if not exist tmp\deploy\store mkdir tmp\deploy\store
set "LOG=tmp\deploy\store\update-5.log"
echo === started %date% %time% > "%LOG%"
git add -A -- src functions/src scripts/store-update-5.cmd >> "%LOG%" 2>&1
git commit -F tmp\commit-store-fixes.txt >> "%LOG%" 2>&1
echo === EXIT commit %errorlevel% >> "%LOG%"
git log -1 --oneline >> "%LOG%" 2>&1
call npx firebase-tools deploy --only functions:onlineStoreSaveListing,functions:onlineStoreGetConfig,functions:publicStoreCatalog,functions:onlineStoreSaveDraft,functions:onlineStoreSetSlug,functions:onlineStorePublish,functions:onlineStoreUnpublish,functions:onlineStoreSetProductVisibility,functions:onlineStoreSetDomain --project zelvoropos --non-interactive >> "%LOG%" 2>&1
echo === EXIT functions %errorlevel% >> "%LOG%"
if errorlevel 1 goto done
call node scripts/store-check-live.mjs >> "%LOG%" 2>&1
if errorlevel 1 (
  echo === ABORT live site changed >> "%LOG%"
  echo ABORTED: the live site changed. Functions are deployed, Hosting was not.
  goto done
)
set "STORE_RELEASE_VERSION=0.9.3"
set "ZELVERO_BASE=/app/0.9.3/"
set "VITE_APP_RELEASE_VERSION=0.9.3"
for /f %%i in ('git rev-parse --short HEAD') do set "SHA=%%i"
set "VITE_APP_BUILD_ID=store-0.9.3+%SHA%"
echo === build %VITE_APP_BUILD_ID% >> "%LOG%"
if exist release-tree\assets robocopy release-tree\assets tmp\prev-tree-assets /E /NFL /NDL /NJH /NJS >> "%LOG%" 2>&1
call npx tsc -b --noEmit >> "%LOG%" 2>&1
echo === EXIT typecheck %errorlevel% >> "%LOG%"
if errorlevel 1 goto done
call npx vite build --mode production --outDir release-tree --emptyOutDir >> "%LOG%" 2>&1
echo === EXIT build %errorlevel% >> "%LOG%"
if errorlevel 1 goto done
if exist tmp\prev-tree-assets robocopy tmp\prev-tree-assets release-tree\assets /E /XC /XN /XO /NFL /NDL /NJH /NJS >> "%LOG%" 2>&1
set "STORE_SHARE_PREVIEWS=1"
call node scripts/store-assemble.mjs >> "%LOG%" 2>&1
echo === EXIT assemble %errorlevel% >> "%LOG%"
if errorlevel 1 goto done
call npx firebase-tools deploy --only hosting --config firebase.store-release.json --project zelvoropos --non-interactive -m "0.9.3 tree: fitting room, keep unsaved store edits, rail price tags, invoice card" >> "%LOG%" 2>&1
echo === EXIT deploy %errorlevel% >> "%LOG%"
:done
echo === finished %date% %time% >> "%LOG%"
echo Finished. You can close this window.
endlocal
