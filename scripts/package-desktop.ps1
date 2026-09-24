# Assemble the FRLcast desktop download: the full local app, ready to unzip and run with no
# install. It bundles a portable Node runtime and the Piper commentary binary, so an operator
# gets automatic timing, driver edits, the poll, the timing API, and the natural Piper voice,
# everything the hosted site cannot do, by double-clicking start.cmd.
#
# Usage (from the repo root):
#   powershell -File scripts\package-desktop.ps1                # core: app + Node + Piper binary
#   powershell -File scripts\package-desktop.ps1 -WithVoices    # also bundle the starter voices
#
# The Piper binary is small and always bundled, so the commentary works out of the box. The
# voice models are large (20 to 75 MB each), so by default they are NOT bundled: the operator
# installs the voices they want from the console's Overlays page, on demand. -WithVoices ships
# the starter set (the voices under tools\piper\voices) for a fully offline first run.

param(
  [switch]$WithVoices,
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

# Piper: always ship the binary (small) so the commentary engine works; ship the big voice
# models only with -WithVoices. The console installs any voice on demand into tools\piper\voices.
if (Test-Path "tools\piper\piper.exe") {
  $pdst = Join-Path $stage "tools\piper"
  New-Item -ItemType Directory -Force -Path (Join-Path $pdst "voices") | Out-Null
  Get-ChildItem "tools\piper" -Force | Where-Object { $_.Name -ne "voices" } |
    Copy-Item -Destination $pdst -Recurse -Force
  if ($WithVoices -and (Test-Path "tools\piper\voices")) {
    Write-Host "==> bundling Piper binary + starter voices"
    Copy-Item "tools\piper\voices\*" -Destination (Join-Path $pdst "voices") -Recurse -Force
  } else {
    Write-Host "==> bundling Piper binary (voices install from the console on demand)"
  }
} else {
  Write-Warning "tools\piper\piper.exe not found; the download will have no commentary voice engine."
}

Write-Host "==> zipping"
$zip = Join-Path $Out ("FRLcast-desktop" + ($(if ($WithVoices) { "-full" } else { "" })) + ".zip")
if (Test-Path $zip) { Remove-Item -LiteralPath $zip -Force }
Compress-Archive -Path (Join-Path $stage "*") -DestinationPath $zip -Force

Write-Host ""
Write-Host "Done: $zip"
Write-Host "Unzip anywhere and double-click start.cmd. No install needed."
