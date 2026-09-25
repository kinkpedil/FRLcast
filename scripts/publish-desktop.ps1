# Cut a desktop release: bump the version, write the notes into an annotated tag, push, and
# let GitHub Actions build and publish it (.github/workflows/release.yml).
#
#   powershell -File scripts\publish-desktop.ps1                 # patch  0.3.0 -> 0.3.1 (fixes)
#   powershell -File scripts\publish-desktop.ps1 -Bump minor     # minor  0.3.1 -> 0.4.0 (features)
#   powershell -File scripts\publish-desktop.ps1 -Bump major     # major  0.4.0 -> 1.0.0
#   powershell -File scripts\publish-desktop.ps1 -Beta           # 0.4.0 -> 0.4.1-beta.1, then -beta.2 ...
#   powershell -File scripts\publish-desktop.ps1                 # on a beta: promotes it (0.4.1-beta.2 -> 0.4.1)
#   powershell -File scripts\publish-desktop.ps1 -DryRun         # show the version and the notes only
#   powershell -File scripts\publish-desktop.ps1 -Local          # build + publish from this machine instead
#   add -WithVoices (implies -Local) to also publish the big FRLcast-desktop-full.zip
#
# The highlights at the top of the notes come from release\next.md (EN + ID, written by
# hand); the change list is generated from the commits. A stable release empties
# release\next.md in its release commit; a beta keeps it, so the stable release that follows
# still carries the highlights.
#
# Why CI builds it: this machine has already been wiped once and every tool had to be
# reinstalled. A release that only one PC can make is a release nobody can make after the
# next reset. -Local is the fallback for when Actions is down.
#
# A beta is a GitHub pre-release: it never becomes "Latest", so the site's download links and
# the default update channel skip it. Only consoles that opted into betas see it.
#
# The tree must be clean (a release is exactly what is committed). If a local build fails,
# the version bump is rolled back. Needs git, node and the GitHub CLI (gh), logged in.
param(
  [ValidateSet('patch', 'minor', 'major')][string]$Bump = 'patch',
  [switch]$Beta,
  [switch]$Local,
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
if ($WithVoices) { $Local = $true }

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

# ---------------------------------------------------------------- version
$current = (node -p "require('./package.json').version").Trim()
$base = $current -replace '-.*$', ''
$p = $base.Split('.') | ForEach-Object { [int]$_ }
switch ($Bump) {
  'major' { $bumped = "$($p[0] + 1).0.0" }
  'minor' { $bumped = "$($p[0]).$($p[1] + 1).0" }
  default { $bumped = "$($p[0]).$($p[1]).$($p[2] + 1)" }
}
$onBeta = $current -match '-beta\.(\d+)$'
if ($Beta) {
  $next = if ($onBeta) { "$base-beta.$([int]$Matches[1] + 1)" } else { "$bumped-beta.1" }
} else {
  # A stable run on a beta promotes that beta rather than skipping past it.
  $next = if ($current -ne $base) { $base } else { $bumped }
}
$tag = "v$next"
if (Invoke-Native { git tag -l $tag }) { throw "Tag $tag already exists." }

# Notes run from the previous release of the same kind: a stable release lists everything
# since the last stable one (betas included), a beta only what is new since the last tag.
Invoke-Native { git fetch --tags --quiet origin } | Out-Null
if ($Beta) { $prevTag = Invoke-Native { git describe --tags --abbrev=0 --match "v*" } }
else { $prevTag = Invoke-Native { git describe --tags --abbrev=0 --match "v*" --exclude "*-*" } }

$zipName = if ($WithVoices) { "FRLcast-desktop-full.zip" } else { "FRLcast-desktop.zip" }
$notesFile = Join-Path $env:TEMP "frlcast-release-$tag.md"
$notesArgs = @('scripts/release-notes.mjs', '--tag', $tag, '--zip', $zipName, '--out', $notesFile)
if ($prevTag) { $notesArgs += @('--prev', $prevTag) }
if (-not $DryRun -and -not $Beta) { $notesArgs += '--reset-draft' }
& node @notesArgs
if ($LASTEXITCODE -ne 0) { throw "release-notes.mjs failed" }

$kind = if ($Beta) { 'beta' } else { $Bump }
Write-Host "==> $current -> $next ($kind), notes since $(if ($prevTag) { $prevTag } else { 'the first commit' }), built by $(if ($Local) { 'this machine' } else { 'GitHub Actions' })"
if ($DryRun) { Write-Host ""; Write-Host ([IO.File]::ReadAllText($notesFile)); Remove-Item $notesFile; return }

# ---------------------------------------------------------------- bump (+ local build)
Invoke-Native { npm version $next --no-git-tag-version --allow-same-version } | Out-Null
function Undo-Bump { Invoke-Native { git checkout -- package.json package-lock.json release/next.md } | Out-Null }
if ($Local) {
  try {
    $ps = (Get-Command powershell -ErrorAction SilentlyContinue).Source
    if (-not $ps) { $ps = "powershell" }
    $pkgArgs = @('-ExecutionPolicy', 'Bypass', '-File', (Join-Path $PSScriptRoot 'package-desktop.ps1'))
    if ($WithVoices) { $pkgArgs += '-WithVoices' }
    & $ps @pkgArgs
    if ($LASTEXITCODE -ne 0) { throw "package-desktop.ps1 failed" }
  } catch {
    Undo-Bump
    throw "Build failed, version bump rolled back: $_"
  }
}

# ---------------------------------------------------------------- commit, tag, push
Invoke-Native { git add package.json package-lock.json release/next.md } | Out-Null
Invoke-Native { git commit -q -m "Release $tag" } | Out-Null
if ($LASTEXITCODE -ne 0) { Undo-Bump; throw "git commit failed" }
# verbatim: the notes' "## Highlights" lines would otherwise be stripped as comments.
Invoke-Native { git tag -a $tag --cleanup=verbatim -F $notesFile } | Out-Null
if ($LASTEXITCODE -ne 0) { throw "git tag failed" }
Remove-Item $notesFile -ErrorAction SilentlyContinue
Invoke-Native { git push -q origin HEAD:main } | Out-Null
if ($LASTEXITCODE -ne 0) { throw "git push failed" }
Invoke-Native { git push -q origin $tag } | Out-Null
if ($LASTEXITCODE -ne 0) { throw "tag push failed" }

$url = "https://github.com/$repo/releases/tag/$tag"
if ($Local) {
  Write-Host "==> publishing from this machine"
  $env:GH = $gh
  & node scripts/release-publish.mjs --tag $tag --zip (Join-Path $root "dist\$zipName")
  if ($LASTEXITCODE -ne 0) { throw "release-publish.mjs failed" }
} else {
  Write-Host "==> $tag pushed; GitHub Actions is building it"
  $runId = $null
  for ($i = 0; $i -lt 20 -and -not $runId; $i++) {
    Start-Sleep -Seconds 3
    $runId = Invoke-Native { & $gh run list --repo $repo --workflow release.yml --branch $tag --limit 1 --json databaseId --jq '.[0].databaseId' }
  }
  if (-not $runId) {
    Write-Warning "No Actions run showed up for $tag. Check https://github.com/$repo/actions, or re-run with -Local."
    exit 1
  }
  Write-Host "    https://github.com/$repo/actions/runs/$runId"
  $prevEap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  & $gh run watch $runId --repo $repo --exit-status --interval 15 | Out-Null
  $ok = $LASTEXITCODE -eq 0
  $ErrorActionPreference = $prevEap
  if (-not $ok) {
    Write-Warning "The build for $tag failed. Fix it and re-run the workflow for $tag from the Actions tab, or publish it from here with: node scripts/release-publish.mjs --tag $tag --zip dist\$zipName (after package-desktop.ps1)."
    exit 1
  }
}

Write-Host ""
Write-Host "Published FRLcast $($tag): $url"
