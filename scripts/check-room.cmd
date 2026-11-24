@echo off
rem LOCAL ONLY: typecheck, lint and tests. Nothing is deployed.
cd /d "%~dp0.."
if not exist tmp mkdir tmp
set "LOG=tmp\check-room.log"
echo === started %date% %time% > "%LOG%"
call npx tsc -p tsconfig.app.json --noEmit >> "%LOG%" 2>&1
echo === EXIT tsc %errorlevel% >> "%LOG%"
call npx eslint src/app src/hooks src/components/ErrorBoundary.tsx src/layouts src/features/dashboard src/features/reports src/features/sales src/features/onlineStore >> "%LOG%" 2>&1
echo === EXIT eslint %errorlevel% >> "%LOG%"
call npx vitest run src/hooks src/app src/features src/domain >> "%LOG%" 2>&1
echo === EXIT tests %errorlevel% >> "%LOG%"
echo === finished %date% %time% >> "%LOG%"
