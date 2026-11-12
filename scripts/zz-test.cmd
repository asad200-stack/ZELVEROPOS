@echo off
rem READ-ONLY: verifies the redeployed AI Preview hosting (root unchanged, both preview paths serve). No writes.
setlocal
cd /d "%~dp0.."
if not exist tmp\deploy mkdir tmp\deploy
set "LOG=tmp\deploy\ai-hosting-verify2.log"
echo === started %date% %time% > "%LOG%"
curl -s -o nul -w "root_index=%%{http_code}\n" https://zelvoropos.web.app/index.html >> "%LOG%" 2>&1
curl -s -o tmp\deploy\root-index-live2.html https://zelvoropos.web.app/index.html >> "%LOG%" 2>&1
curl -s -o nul -w "ai_preview_open=%%{http_code}\n" https://zelvoropos.web.app/app/0.9.2-ai.1/open.html >> "%LOG%" 2>&1
curl -s -o nul -w "ai_preview_index=%%{http_code}\n" https://zelvoropos.web.app/app/0.9.2-ai.1/index.html >> "%LOG%" 2>&1
curl -s -o nul -w "ai_preview_sw=%%{http_code}\n" https://zelvoropos.web.app/app/0.9.2-ai.1/sw.js >> "%LOG%" 2>&1
curl -s -o nul -w "admin_preview_open=%%{http_code}\n" https://zelvoropos.web.app/app/0.9.1-admin.1/open.html >> "%LOG%" 2>&1
echo === finished %date% %time% >> "%LOG%"
echo Finished. You can close this window.
endlocal
