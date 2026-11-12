# Local-only Vite POS against Firebase emulators (demo-zelvero).
# Requires emulators already running (see scripts/start-emulators-local.ps1).
# Does not deploy. Does not load production or staging env.

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $root

Write-Host 'Starting Vite in emulator mode on http://127.0.0.1:5199'
Write-Host 'Open that URL after Auth/Firestore/Functions/Storage emulators are ready.'
npx vite --mode emulator --host 127.0.0.1 --port 5199
