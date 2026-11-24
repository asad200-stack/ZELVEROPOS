@echo off
rem LOCAL ONLY: typecheck, lint and tests for the fitting room changes. Nothing is deployed.
cd /d "%~dp0.."
if not exist tmp mkdir tmp
set "LOG=tmp\check-room.log"
echo === started %date% %time% > "%LOG%"
call npx tsc -p tsconfig.app.json --noEmit >> "%LOG%" 2>&1
echo === EXIT tsc %errorlevel% >> "%LOG%"
call npx eslint src/features/onlineStore/FittingRoomCard.tsx src/features/onlineStore/FittingRoom.tsx >> "%LOG%" 2>&1
echo === EXIT eslint %errorlevel% >> "%LOG%"
call npx vitest run src/features/onlineStore src/i18n >> "%LOG%" 2>&1
echo === EXIT tests %errorlevel% >> "%LOG%"
echo === finished %date% %time% >> "%LOG%"
