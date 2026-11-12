param(
  [int]$Context = 2048,
  [int]$Threads = 6,
  [int]$Port = 8081
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$server = Join-Path $root 'local-ai\runtime\b11890\llama-server.exe'
$model = Join-Path $root 'local-ai\models\Qwen_Qwen3-4B-Instruct-2507-Q4_K_M.gguf'

if (-not (Test-Path -LiteralPath $server)) {
  throw "llama-server is missing: $server"
}
if (-not (Test-Path -LiteralPath $model)) {
  throw "Qwen model file is missing: $model"
}

& $server `
  -m $model `
  --host 127.0.0.1 `
  --port $Port `
  -c $Context `
  -ngl 0 `
  -t $Threads `
  -tb $Threads `
  -np 1 `
  --no-webui `
  --jinja `
  --reasoning off `
  --cors-origins localhost `
  -ctk q8_0 `
  -ctv q8_0
