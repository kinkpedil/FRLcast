# Open the FRLcast console in a chromeless "app" window (Edge or Chrome in --app mode) so it
# looks like a standalone program rather than a browser tab. Falls back to the default
# browser when neither is installed. start.cmd launches this detached, a couple of seconds
# after the server starts, so the window opens to a page that is already up.
#
# The OBS overlays are separate: add them in OBS as Browser Sources pointing at the
# http://localhost:4700/overlay/... URLs, exactly as on the hosted site.
Start-Sleep -Seconds 2
$url = 'http://localhost:4700'
$candidates = @(
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe"
)
$browser = $candidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
if ($browser) {
  Start-Process $browser @("--app=$url", "--window-size=1400,920")
} else {
  Start-Process $url
}
