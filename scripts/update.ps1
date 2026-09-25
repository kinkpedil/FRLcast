# Install a downloaded FRLcast version over this one, then start FRLcast again.
#
# Started by the server (server/updates.js) after it has downloaded and verified the new zip;
# the server then exits, because Windows will not let a running node.exe be replaced. Not
# meant to be run by hand, but it is safe to: it only ever adds and replaces app files.
#
# What it never touches: data\ (the event, driver accounts, API key, settings), certs\,
# tools\piper\voices (installed voices) and public\brand (the uploaded logo). The new zip
# does not carry those anyway; they are excluded again here so a future package that did
# could still never overwrite them. data\ is copied to backups\ first regardless.
#
# If anything fails, the old version starts again and the window stays open with the reason.
param(
  [Parameter(Mandatory = $true)][string]$Zip,
  [Parameter(Mandatory = $true)][string]$Root,
  [int]$WaitPid = 0,
  [int]$ParentPid = 0,
  [string]$From = '?',
  [string]$To = '?'
)
$ErrorActionPreference = 'Stop'
try { $Host.UI.RawUI.WindowTitle = "FRLcast update v$From -> v$To" } catch {}

function Say($text, $color = 'Gray') { Write-Host "  $text" -ForegroundColor $color }

Write-Host ''
Say "FRLcast update: v$From -> v$To" 'Cyan'
Say 'Do not close this window. FRLcast starts again by itself when it is done.'
Write-Host ''

$stage = Join-Path $Root '.update-staging'
$backup = $null
$ok = $false
try {
  # 1. Wait for the old server to let go of its files.
  if ($WaitPid) {
    Say 'Waiting for FRLcast to stop...'
    try { Wait-Process -Id $WaitPid -Timeout 30 -ErrorAction Stop } catch {}
    if (Get-Process -Id $WaitPid -ErrorAction SilentlyContinue) { Stop-Process -Id $WaitPid -Force }
  }
  # The old launcher window is now sitting on "Press any key". Close it, but only when it
  # really is start.cmd: under `npm start` the parent is the operator's own terminal.
  if ($ParentPid) {
    $parent = Get-CimInstance Win32_Process -Filter "ProcessId=$ParentPid" -ErrorAction SilentlyContinue
    if ($parent -and $parent.Name -eq 'cmd.exe' -and $parent.CommandLine -match 'start\.cmd') {
      Stop-Process -Id $ParentPid -Force -ErrorAction SilentlyContinue
    }
  }

  # 2. Back up data\ (everything the operator made), keeping the last five backups.
  $dataDir = Join-Path $Root 'data'
  if (Test-Path $dataDir) {
    $backup = Join-Path $Root ("backups\before-v$To-" + (Get-Date -Format 'yyyyMMdd-HHmmss'))
    Say "Backing up your data to $backup"
    robocopy $dataDir (Join-Path $backup 'data') /E /XD (Join-Path $dataDir 'updates') /R:2 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "Could not back up data (robocopy $LASTEXITCODE)" }
    Get-ChildItem (Join-Path $Root 'backups') -Directory | Sort-Object CreationTime -Descending |
      Select-Object -Skip 5 | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
  }

  # 3. Unpack. ZipFile rather than Expand-Archive: several times faster on node_modules.
  Say 'Unpacking the new version...'
  if (Test-Path $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  [IO.Compression.ZipFile]::ExtractToDirectory($Zip, $stage)
  if (-not (Test-Path (Join-Path $stage 'server\index.js'))) { throw 'The download is not an FRLcast desktop package.' }

  # 4. Copy it over this one: add and replace only, never delete, never the operator's files.
  Say 'Installing...'
  $keep = @('data', 'certs', 'tools\piper\voices', 'public\brand', 'backups') | ForEach-Object { Join-Path $stage $_ }
  robocopy $stage $Root /E /XD @keep /R:5 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "Copying the new files failed (robocopy $LASTEXITCODE). A file may be in use." }

  Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $Zip -Force -ErrorAction SilentlyContinue
  $ok = $true
  Write-Host ''
  Say "Updated to v$To." 'Green'
} catch {
  Write-Host ''
  Say "The update did not finish: $($_.Exception.Message)" 'Red'
  if ($backup) { Say "Your data is safe, and also copied to $backup" 'Yellow' }
  Say 'FRLcast will start again now. You can download the new version from' 'Yellow'
  Say 'https://github.com/kinkpedil/FRLcast/releases/latest' 'Yellow'
  Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue
}

# 5. Start FRLcast again. The console that asked for the update is still open and reloads
#    itself when the server answers, so the launcher must not open a second one.
$env:FRL_NO_OPEN = '1'
Start-Process -FilePath (Join-Path $Root 'start.cmd') -WorkingDirectory $Root
if ($ok) { Start-Sleep -Seconds 3 } else { Read-Host '  Press Enter to close this window' | Out-Null }
