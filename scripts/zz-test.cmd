@echo off
setlocal
cd /d "%~dp0.."
set LOG=tmp\deploy\hosting-remove-generic-update-toast-20261113.log
echo === starting %DATE% %TIME% > "%LOG%"

echo [1/5] precheck live hosting state (informational) >> "%LOG%"
call npx firebase-tools hosting:channel:list --project zelvoropos --json >> "%LOG%" 2>>&1
echo PRECHECK_LOGGED >> "%LOG%"

echo [2/5] npm run build >> "%LOG%"
call npm run build >> "%LOG%" 2>>&1
if errorlevel 1 (
  echo BUILD_FAILED >> "%LOG%"
  goto done
)
echo BUILD_OK >> "%LOG%"

echo [3/5] copy preview subtrees >> "%LOG%"
xcopy /E /I /Y hosting-deliverable\app\0.9.1-admin.1 dist\app\0.9.1-admin.1 >> "%LOG%" 2>>&1
xcopy /E /I /Y hosting-deliverable\app\0.9.2-ai.1 dist\app\0.9.2-ai.1 >> "%LOG%" 2>>&1
echo COPY_OK >> "%LOG%"

echo [4/5] deploy hosting:production >> "%LOG%"
call npx firebase-tools deploy --only hosting:production --project zelvoropos --non-interactive -m "Remove generic auto-detected update toast" >> "%LOG%" 2>>&1
if errorlevel 1 (
  echo DEPLOY_FAILED >> "%LOG%"
  goto done
)
echo DEPLOY_OK >> "%LOG%"

echo [5/5] postcheck curl >> "%LOG%"
curl -s -o NUL -w "root_index=%%{http_code}\n" https://zelvoropos.web.app/ >> "%LOG%" 2>>&1
curl -s -o NUL -w "admin_preview_open=%%{http_code}\n" https://zelvoropos.web.app/app/0.9.1-admin.1/index.html >> "%LOG%" 2>>&1
curl -s -o NUL -w "ai_preview_open=%%{http_code}\n" https://zelvoropos.web.app/app/0.9.2-ai.1/index.html >> "%LOG%" 2>>&1
echo POSTCHECK_DONE >> "%LOG%"

:done
echo === finished %DATE% %TIME% >> "%LOG%"
endlocal
