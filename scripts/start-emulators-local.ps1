# Local-only Firebase Emulator Suite for demo-zelvero.
# Session PATH only — does not change machine-wide Java settings.
# Skips Pub/Sub (port 8085) so leftover Java there does not block startup.
# Never deploy. Never use zelvoropos / zelvoropos-stage.

$ErrorActionPreference = 'Stop'
$jdk = 'C:\Program Files\Eclipse Adoptium\jdk-25.0.2.10-hotspot'
if (-not (Test-Path -LiteralPath "$jdk\bin\java.exe")) {
  throw "JDK 25 not found at $jdk. Install Temurin 25 or update this script path."
}

$env:JAVA_HOME = $jdk
$env:Path = "$jdk\bin;" + $env:Path
$env:CLOUDSDK_CORE_DISABLE_PROMPTS = '1'
$env:FUNCTIONS_DISCOVERY_TIMEOUT = '90'

Write-Host 'Java (must be 21+):'
& "$jdk\bin\java.exe" -version
Write-Host "Resolved: $((Get-Command java).Source)"

$root = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $root

node scripts/firebase-guard.mjs --emulator --project=demo-zelvero
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

npm --prefix functions run build
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

npx firebase-tools emulators:start --only auth,firestore,functions,storage --project demo-zelvero
