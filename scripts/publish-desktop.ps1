# Ship a desktop release: bump the version, build the download, tag it, and publish a NEW
# GitHub release whose notes list what changed since the previous one.
#
#   powershell -File scripts\publish-desktop.ps1                 # patch  0.2.0 -> 0.2.1 (fixes)
#   powershell -File scripts\publish-desktop.ps1 -Bump minor     # minor  0.2.1 -> 0.3.0 (features)
#   powershell -File scripts\publish-desktop.ps1 -Bump major     # major  0.3.0 -> 1.0.0
#   powershell -File scripts\publish-desktop.ps1 -DryRun         # show the version and notes only
#   add -WithVoices to bundle the starter voices (a much bigger download)
#
# Every release stays on GitHub with the newest marked Latest, so the Releases page is the
# update history. The asset is always FRLcast-desktop.zip, so the website's
# .../releases/latest link keeps pointing at the newest build without any edit.
#
# The working tree must be clean: a release is exactly what is committed. If the build fails,
# the version bump is rolled back, so there is never a half-made release.
# Needs git and the GitHub CLI (gh), logged in.
param(
  [ValidateSet('patch', 'minor', 'major')][string]$Bump = 'patch',
  [switch]$WithVoices,
  [switch]$DryRun
)
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$repo = "kinkpedil/FRLcast"
$gh = (Get-Command gh -ErrorAction SilentlyContinue).Source
if (-not $gh) { $gh = "C:\Program Files\GitHub CLI\gh.exe" }

# Native tools write progress to stderr; under "Stop" PowerShell 5.1 would treat that as a
# failure, so run them with "Continue" and judge them by their exit code instead.
function Invoke-Native([scriptblock]$cmd) {
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try { $out = & $cmd 2>$null } finally { $ErrorActionPreference = $prev }
  return $out
}

if (Invoke-Native { git status --porcelain --untracked-files=no }) {
  throw "Uncommitted changes. Commit them first: a release has to match what is in git."
}

# ---------------------------------------------------------------- version + notes
$current = (node -p "require('./package.json').version").Trim()
$p = $current.Split('.') | ForEach-Object { [int]$_ }
switch ($Bump) {
  'major' { $next = "$($p[0] + 1).0.0" }
  'minor' { $next = "$($p[0]).$($p[1] + 1).0" }
  default { $next = "$($p[0]).$($p[1]).$($p[2] + 1)" }
}
$tag = "v$next"
if (Invoke-Native { git tag -l $tag }) { throw "Tag $tag already exists." }

Invoke-Native { git fetch --tags --quiet origin } | Out-Null
$prevTag = (Invoke-Native { git describe --tags --abbrev=0 --match "v*" })
$range = if ($prevTag) { "$prevTag..HEAD" } else { "HEAD" }
$subjects = Invoke-Native { git log $range --no-merges --pretty=format:"%s" } |
  Where-Object { $_ -and $_ -notmatch '^(Deploy:|Release v)' } |
  ForEach-Object { $_ -replace '\s*\u2014\s*', ': ' }   # older subjects may carry an em-dash

$zipName = if ($WithVoices) { "FRLcast-desktop-full.zip" } else { "FRLcast-desktop.zip" }
$lines = @("## What's new in $tag", "")
if ($subjects) { $lines += ($subjects | ForEach-Object { "- $_" }) } else { $lines += "- Maintenance build." }
$lines += @(
  "",
  "## Download",
  "**$zipName** below: unzip anywhere and double-click ``start.cmd``. Nothing to install.",
  ""
)
if ($prevTag) { $lines += "**Full changelog:** https://github.com/$repo/compare/$prevTag...$tag" }
$notes = ($lines -join "`n") + "`n"

Write-Host "==> $current -> $next ($Bump), notes since $(if ($prevTag) { $prevTag } else { 'the first commit' })"
if ($DryRun) { Write-Host ""; Write-Host $notes; return }

# ---------------------------------------------------------------- bump, build, release
Invoke-Native { npm version $next --no-git-tag-version --allow-same-version } | Out-Null
try {
  $ps = (Get-Command powershell -ErrorAction SilentlyContinue).Source
  if (-not $ps) { $ps = "powershell" }
  $pkgArgs = @('-ExecutionPolicy', 'Bypass', '-File', (Join-Path $PSScriptRoot 'package-desktop.ps1'))
  if ($WithVoices) { $pkgArgs += '-WithVoices' }
  & $ps @pkgArgs
  if ($LASTEXITCODE -ne 0) { throw "package-desktop.ps1 failed" }
} catch {
  Invoke-Native { git checkout -- package.json package-lock.json } | Out-Null
  throw "Build failed, version bump rolled back: $_"
}

Invoke-Native { git add package.json package-lock.json } | Out-Null
Invoke-Native { git commit -q -m "Release $tag" } | Out-Null
if ($LASTEXITCODE -ne 0) { throw "git commit failed" }
Invoke-Native { git tag -a $tag -m "FRLcast $tag" } | Out-Null
Invoke-Native { git push -q origin HEAD:main } | Out-Null
if ($LASTEXITCODE -ne 0) { throw "git push failed" }
Invoke-Native { git push -q origin $tag } | Out-Null
if ($LASTEXITCODE -ne 0) { throw "tag push failed" }

$notesFile = Join-Path $env:TEMP "frlcast-release-$tag.md"
[IO.File]::WriteAllText($notesFile, $notes, (New-Object Text.UTF8Encoding $false))
Write-Host "==> creating GitHub release $tag"
& $gh release create $tag (Join-Path $root "dist\$zipName") --repo $repo --title "FRLcast $tag" --notes-file $notesFile --latest --verify-tag
if ($LASTEXITCODE -ne 0) { throw "gh release create failed" }
Remove-Item $notesFile -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "Published FRLcast $($tag): https://github.com/$repo/releases/tag/$tag"
