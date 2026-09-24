# Rebuild the desktop download and upload it to the GitHub release, in one step.
#
#   powershell -File scripts\publish-desktop.ps1                # core build (voices from console)
#   powershell -File scripts\publish-desktop.ps1 -WithVoices    # bundle the starter voices too
#
# Needs the GitHub CLI (gh) installed and logged in. The release tag defaults to v0.1.0.
param(
  [switch]$WithVoices,
  [string]$Tag = "v0.1.0"
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$ps = (Get-Command powershell -ErrorAction SilentlyContinue).Source
if (-not $ps) { $ps = "powershell" }
if ($WithVoices) {
  & $ps -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "package-desktop.ps1") -WithVoices
} else {
  & $ps -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "package-desktop.ps1")
}
if ($LASTEXITCODE -ne 0) { throw "package-desktop.ps1 failed" }

$zip = if ($WithVoices) { "dist\FRLcast-desktop-full.zip" } else { "dist\FRLcast-desktop.zip" }
$other = if ($WithVoices) { "FRLcast-desktop.zip" } else { "FRLcast-desktop-full.zip" }

$gh = (Get-Command gh -ErrorAction SilentlyContinue).Source
if (-not $gh) { $gh = "C:\Program Files\GitHub CLI\gh.exe" }

Write-Host "==> uploading $zip to release $Tag"
# Keep exactly one asset: drop the other variant if it is on the release, then upload this one.
& $gh release delete-asset $Tag $other --yes 2>$null
& $gh release upload $Tag $zip --clobber
if ($LASTEXITCODE -ne 0) { throw "gh release upload failed" }

Write-Host ""
Write-Host "Published $zip to release $Tag."
