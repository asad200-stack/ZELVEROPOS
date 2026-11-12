@echo off
rem LOCAL ONLY: tests the on-disk Qwen model through the copilot code (loopback 127.0.0.1:8081). No Firebase.
setlocal
cd /d "%~dp0.."
set "LOG=tmp\ai-eval\qwen-eval.log"
echo Zelvero local Qwen evaluation (may take several minutes on CPU) - writing %LOG% ...
echo === started %date% %time% > "%LOG%"
node tmp\ai-eval\qwen-eval.mjs >> "%LOG%" 2>&1
echo === EXIT eval %errorlevel% >> "%LOG%"
echo === finished %date% %time% >> "%LOG%"
echo Finished. You can close this window.
endlocal
