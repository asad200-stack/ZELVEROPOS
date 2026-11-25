@echo off
rem LOCAL ONLY: typecheck, lint and tests. Nothing is deployed.
cd /d "%~dp0.."
if not exist tmp mkdir tmp
set "LOG=tmp\check-room.log"
echo === started %date% %time% > "%LOG%"
call npm --prefix functions run typecheck >> "%LOG%" 2>&1
call npm --prefix functions run build >> "%LOG%" 2>&1
echo === EXIT fn-typecheck %errorlevel% >> "%LOG%"
call npx tsc -p tsconfig.app.json --noEmit >> "%LOG%" 2>&1
echo === EXIT tsc %errorlevel% >> "%LOG%"
call npx eslint src/app src/hooks src/features/onlineStore functions/src/storePage.ts functions/src/keepWarm.ts functions/src/onlineStore.ts functions/src/shopper.ts functions/src/onlineOrders.ts src/domain src/firebase/app.ts >> "%LOG%" 2>&1
echo === EXIT eslint %errorlevel% >> "%LOG%"
call npx vitest run src >> "%LOG%" 2>&1
echo === EXIT tests %errorlevel% >> "%LOG%"
echo === finished %date% %time% >> "%LOG%"
