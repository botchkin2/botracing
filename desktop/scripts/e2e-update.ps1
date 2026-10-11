# The tray update rehearsal, for a CLEAN Windows runner (.github/workflows/
# tray-e2e.yml, job "update"). It installs version N-1, serves version N from a
# local endpoint, and checks that the installed tray finds N, downloads it,
# installs it on `botracing.exe --update` (the menu's "Restart to update") and
# comes back as N. Both installers carry a throwaway updater key made in the
# job (pit wall #4434/#4435); the real key is never used.
#
#   .\desktop\scripts\e2e-update.ps1 -Old <N-1 setup.exe> -New <N setup.exe> `
#       -Signature <N setup.exe.sig> -Version <N> [-Port 8765]
#
# The N-1 installer must have been built with plugins.updater.endpoints set to
# http://127.0.0.1:<Port>/latest.json and the throwaway public key.
#
# NEVER run it on a PC that has BotRacing installed: it installs over it. It
# refuses when it finds an install. It runs the real (default) profile, not a
# BOTRACING_PROFILE: only the real tray checks for updates (main.rs), and a
# clean runner has no real tray to protect.
param(
  [Parameter(Mandatory = $true)][string]$Old,
  [Parameter(Mandatory = $true)][string]$New,
  [Parameter(Mandatory = $true)][string]$Signature,
  [Parameter(Mandatory = $true)][string]$Version,
  [int]$Port = 8765
)
$ErrorActionPreference = "Stop"

$app = "BotRacing"
$uninstallKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$app"
$data = Join-Path $env:LOCALAPPDATA $app
$quitLog = Join-Path $data "quit.log"
$server = $null

function Step($name) { Write-Host "`n== $name" }
function Trays { @(Get-Process -Name $app -ErrorAction SilentlyContinue) }
function Fail($message) {
  Write-Host "UPDATE E2E FAILED: $message"
  Write-Host "trays: $((Trays | ForEach-Object { "pid $($_.Id) $($_.Path) $($_.MainModule.FileVersionInfo.ProductVersion)" }) -join '; ')"
  if (Test-Path $data) {
    Write-Host "-- $data"
    Get-ChildItem $data -Recurse -File -ErrorAction SilentlyContinue | ForEach-Object { Write-Host "   $($_.FullName.Substring($data.Length)) ($($_.Length) bytes)" }
    foreach ($log in @("quit.log", "install.log", "uploader\sidecar.log")) {
      $file = Join-Path $data $log
      if (Test-Path $file) { Write-Host "-- $log"; Get-Content $file -Tail 40 }
    }
  }
  if ($server -and -not $server.HasExited) { $server.Kill() }
  exit 1
}
function WaitFor($what, $seconds, [scriptblock]$test) {
  $until = (Get-Date).AddSeconds($seconds)
  while ((Get-Date) -lt $until) {
    if (& $test) { return }
    Start-Sleep -Milliseconds 500
  }
  Fail "timed out after ${seconds}s waiting for: $what"
}
function InstalledExe {
  $entry = Get-ItemProperty $uninstallKey -ErrorAction SilentlyContinue
  if (-not $entry) { return $null }
  $dir = $entry.InstallLocation -replace '"', ''
  if (-not $dir) { $dir = Split-Path ($entry.UninstallString -replace '"', '') -Parent }
  Join-Path $dir "$app.exe"
}
function VersionOf($file) { (Get-Item $file).VersionInfo.ProductVersion }

foreach ($f in @($Old, $New, $Signature)) { if (-not (Test-Path $f)) { Fail "missing $f" } }
if ((Test-Path $uninstallKey) -or (Test-Path $data) -or (Trays).Count) {
  Fail "$app is already installed or running here: run this only on a clean runner"
}

Step "serve N ($Version) at http://127.0.0.1:$Port/latest.json"
$serve = Join-Path ([IO.Path]::GetTempPath()) "botracing-update-$([guid]::NewGuid())"
New-Item -ItemType Directory $serve | Out-Null
$name = Split-Path $New -Leaf
Copy-Item $New (Join-Path $serve $name)
# The static manifest shape tauri-plugin-updater 2.x reads (RemoteRelease:
# `platforms` keyed by "<os>-<arch>"); production answers the flat dynamic one.
$manifest = [ordered]@{
  version   = $Version
  notes     = "update rehearsal"
  pub_date  = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
  platforms = @{
    "windows-x86_64" = @{
      signature = (Get-Content $Signature -Raw).Trim()
      url       = "http://127.0.0.1:$Port/$name"
    }
  }
}
$manifest | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $serve "latest.json") -Encoding utf8NoBOM
$python = (Get-Command python -ErrorAction SilentlyContinue).Source
if (-not $python) { Fail "python is not on PATH (it serves the update)" }
$server = Start-Process -FilePath $python -ArgumentList "-m", "http.server", "$Port", "--bind", "127.0.0.1", "--directory", "`"$serve`"" -PassThru -WindowStyle Hidden
WaitFor "the local update endpoint" 30 {
  try { (Invoke-WebRequest "http://127.0.0.1:$Port/latest.json" -UseBasicParsing).StatusCode -eq 200 } catch { $false }
}
Write-Host (Get-Content (Join-Path $serve "latest.json") -Raw)

Step "install N-1 (silent, per user)"
$proc = Start-Process -FilePath $Old -ArgumentList "/S" -PassThru -Wait
if ($proc.ExitCode -ne 0) { Fail "N-1 installer exit code $($proc.ExitCode)" }
$exe = InstalledExe
if (-not $exe -or -not (Test-Path $exe)) { Fail "no $app.exe after installing N-1" }
$oldVersion = VersionOf $exe
Write-Host "installed $exe, version $oldVersion"
if ($oldVersion -like "$Version*") { Fail "N-1 already reports version ${Version}: build N-1 with an older version" }

Step "launch N-1 and wait for it to download N"
Start-Process -FilePath $exe -ArgumentList "--background" | Out-Null
WaitFor "a tray process" 30 { (Trays).Count -ge 1 }
$downloaded = Join-Path $data "update\$Version.exe"
WaitFor "the tray to download $downloaded" 120 { Test-Path $downloaded }
Write-Host "downloaded $downloaded ($((Get-Item $downloaded).Length) bytes)"
# The slot is filled right after the file is renamed into place.
Start-Sleep -Seconds 3

Step "botracing.exe --update"
$oldPid = (Trays)[0].Id
$u = Start-Process -FilePath $exe -ArgumentList "--update" -PassThru -Wait
Write-Host "--update exit code $($u.ExitCode)"
WaitFor "the installed exe to be version $Version" 180 {
  (Test-Path $exe) -and ((VersionOf $exe) -like "$Version*")
}
WaitFor "a tray of version $Version running (the installer's /R restart)" 120 {
  @(Trays | Where-Object { $_.Id -ne $oldPid -and $_.Path -and ((VersionOf $_.Path) -like "$Version*") }).Count -ge 1
}
$now = Trays | ForEach-Object { "pid $($_.Id) $($_.Path) $(VersionOf $_.Path)" }
Write-Host "running after the update: $($now -join '; ')"

Step "quit.log"
if (-not (Test-Path $quitLog)) { Fail "no quit.log: --update never reached the running tray" }
$lines = @(Get-Content $quitLog)
Write-Host "quit.log: $($lines -join ' | ')"
if (-not ($lines -match "^update installing $([regex]::Escape($Version)) ")) { Fail "quit.log has no 'update installing $Version'" }
if ($lines -match "exit forced") { Fail "quit.log says 'exit forced': the installer did not end the tray" }
if ($lines -match "update failed") { Fail "quit.log says the update failed" }

Step "uninstall (silent)"
$uninstaller = (Get-ItemProperty $uninstallKey).UninstallString -replace '"', ''
$un = Start-Process -FilePath $uninstaller -ArgumentList "/S" -PassThru -Wait
if ($un.ExitCode -ne 0) { Fail "uninstaller exit code $($un.ExitCode)" }
WaitFor "the uninstaller to remove $exe" 60 { -not (Test-Path $exe) }
WaitFor "no tray left" 20 { (Trays).Count -eq 0 }
$server.Kill()

Write-Host "`nUPDATE E2E OK: $oldVersion -> $Version through --update."
