@echo off
rem Run only with the owner's approval: Google search data, sitemaps and robots.txt, the product
rem catalogue feed for Facebook / Instagram / Google, and small photos for phones. Deploys ONLY the
rem functions publicStorePage and publicStoreImage, then the store tree /app/0.9.3/ with the new
rem rewrites (photos, robots.txt) on Hosting, then keepStoresWarm (its failure doesn't stop the rest).
setlocal
cd /d "%~dp0.."
if not exist tmp\deploy\store mkdir tmp\deploy\store
set "LOG=tmp\deploy\store\update-13.log"
echo === started %date% %time% > "%LOG%"
git add -A -- src functions/src functions/package.json functions/package-lock.json functions/scripts/copy-shared.mjs index.html public/boot.js scripts/store-assemble.mjs scripts/prepare-13.cmd scripts/store-update-12.cmd scripts/store-update-13.cmd >> "%LOG%" 2>&1
git commit -F tmp\commit-seo-feed.txt >> "%LOG%" 2>&1
echo === EXIT commit %errorlevel% >> "%LOG%"
git log -1 --oneline >> "%LOG%" 2>&1
call npx firebase-tools deploy --only functions:publicStorePage,functions:publicStoreImage --project zelvoropos --non-interactive >> "%LOG%" 2>&1
echo === EXIT functions %errorlevel% >> "%LOG%"
if errorlevel 1 goto done
git log -1 --oneline >> "%LOG%" 2>&1
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
set "STORE_IMAGES=1"
call node scripts/store-assemble.mjs >> "%LOG%" 2>&1
echo === EXIT assemble %errorlevel% >> "%LOG%"
if errorlevel 1 goto done
call npx firebase-tools deploy --only hosting --config firebase.store-release.json --project zelvoropos --non-interactive -m "0.9.3 tree: Google data, catalogue feed, small photos" >> "%LOG%" 2>&1
echo === EXIT deploy %errorlevel% >> "%LOG%"
call npx firebase-tools deploy --only functions:keepStoresWarm --project zelvoropos --non-interactive >> "%LOG%" 2>&1
echo === EXIT keepwarm %errorlevel% >> "%LOG%"
:done
echo === finished %date% %time% >> "%LOG%"
echo Finished. You can close this window.
endlocal
