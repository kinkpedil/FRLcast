# Assemble the FRLcast desktop download: the full local app, ready to unzip and run with no
# install. It bundles a portable Node runtime and (optionally) the Piper commentary voice, so
# an operator gets automatic timing, driver edits, the poll, and the natural Piper voice --
# everything the hosted site cannot do -- by double-clicking start.cmd.
#
# Usage (from the repo root):
#   powershell -File scripts\package-desktop.ps1                # lite: app + Node, no Piper
#   powershell -File scripts\package-desktop.ps1 -Piper         # full: also bundle tools\piper
#
# The Piper binary + voices are big (a voice is 20-75 MB each), so the lite build stays small
# and the operator installs voices from the console's Overlays page on first run instead.

param(
  [switch]$Piper,
  [string]$NodeVersion = "24.19.0",
  [string]$Out = "dist"
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$stage = Join-Path $Out "FRLcast"
if (Test-Path $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
New-Item -ItemType Directory -Force -Path $stage | Out-Null

Write-Host "==> copying app"
foreach ($item in @("public", "server", "scripts", "package.json", "package-lock.json", "start.cmd", "README.md", "SETUP.md")) {
  if (Test-Path $item) { Copy-Item $item -Destination $stage -Recurse -Force }
}

Write-Host "==> production dependencies"
# A clean production install into the staged copy, so node_modules matches what ships.
Push-Location $stage
& npm install --omit=dev --no-audit --no-fund
Pop-Location

Write-Host "==> bundling Node runtime v$NodeVersion"
$nodeZip = Join-Path $Out "node.zip"
$nodeUrl = "https://nodejs.org/dist/v$NodeVersion/node-v$NodeVersion-win-x64.zip"
if (-not (Test-Path $nodeZip)) { Invoke-WebRequest -Uri $nodeUrl -OutFile $nodeZip -UseBasicParsing }
$nodeTmp = Join-Path $Out "node-tmp"
if (Test-Path $nodeTmp) { Remove-Item -LiteralPath $nodeTmp -Recurse -Force }
Expand-Archive -LiteralPath $nodeZip -DestinationPath $nodeTmp -Force
$runtime = Join-Path $stage "runtime"
New-Item -ItemType Directory -Force -Path $runtime | Out-Null
Copy-Item (Join-Path $nodeTmp "node-v$NodeVersion-win-x64\*") -Destination $runtime -Recurse -Force

if ($Piper) {
  if (Test-Path "tools\piper") {
    Write-Host "==> bundling Piper (binary + installed voices)"
    Copy-Item "tools" -Destination $stage -Recurse -Force
  } else {
    Write-Warning "tools\piper not found; skipping Piper. Operators can install voices from the console instead."
  }
}

Write-Host "==> zipping"
$zip = Join-Path $Out ("FRLcast-desktop" + ($(if ($Piper) { "-full" } else { "" })) + ".zip")
if (Test-Path $zip) { Remove-Item -LiteralPath $zip -Force }
Compress-Archive -Path (Join-Path $stage "*") -DestinationPath $zip -Force

Write-Host ""
Write-Host "Done: $zip"
Write-Host "Unzip anywhere and double-click start.cmd. No install needed."
