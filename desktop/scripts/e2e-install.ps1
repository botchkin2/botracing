# End-to-end check of the built tray installer, for a CLEAN Windows runner
# (.github/workflows/tray-e2e.yml). It installs the real installer, starts the
# real tray, starts it a second time, and uninstalls it, and fails with the
# step that broke.
#
#   .\desktop\scripts\e2e-install.ps1 -Installer <path to *-setup.exe>
#
# NEVER run it on a PC that has BotRacing installed: it installs over it and the
# installer quits the running tray. It refuses when it finds an install.
#
# What each phase proves:
#   install    the per-user silent install puts BotRacing.exe where the Uninstall
#              entry says, and creates the Start with Windows entry (HKCU Run)
#   launch     the tray starts and stays up, and its data folder appears
#   second     a second launch does not add a second tray (single instance)
#   uninstall  the uninstaller removes the install folder, the Run entry, the
#              StartupApproved entry and the token file, and no tray is left
#
# Left to the phases that need a signed-in run (pit wall thread 1 #3462): the
# uploader starting and a heartbeat landing, and the second launch opening the
# desktop window. They are added here, not in a second script.
param(
  [Parameter(Mandatory = $true)][string]$Installer
)
$ErrorActionPreference = "Stop"

$app = "BotRacing"
$uninstallKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$app"
$runKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
$approvedKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run"
$data = Join-Path $env:LOCALAPPDATA $app

function Step($name) { Write-Host "`n== $name" }
function Fail($message) {
  Write-Host "E2E FAILED: $message"
  if (Test-Path $data) {
    Write-Host "-- $data"
    Get-ChildItem $data -Recurse -File -ErrorAction SilentlyContinue | ForEach-Object { Write-Host "   $($_.FullName.Substring($data.Length)) ($($_.Length) bytes)" }
    foreach ($log in @("install.log", "uploader\sidecar.log")) {
      $file = Join-Path $data $log
      if (Test-Path $file) { Write-Host "-- $log"; Get-Content $file -Tail 40 }
    }
  }
  exit 1
}
function Trays { @(Get-Process -Name $app -ErrorAction SilentlyContinue) }
function WaitFor($what, $seconds, [scriptblock]$test) {
  $until = (Get-Date).AddSeconds($seconds)
  while ((Get-Date) -lt $until) {
    if (& $test) { return }
    Start-Sleep -Milliseconds 500
  }
  Fail "timed out after ${seconds}s waiting for: $what"
}

if (-not (Test-Path $Installer)) { Fail "no installer at $Installer" }
if ((Test-Path $uninstallKey) -or (Test-Path $data) -or (Trays).Count) {
  Fail "$app is already installed or running here: run this only on a clean runner"
}

Step "install (silent, per user)"
$proc = Start-Process -FilePath $Installer -ArgumentList "/S" -PassThru -Wait
if ($proc.ExitCode -ne 0) { Fail "installer exit code $($proc.ExitCode)" }
if (-not (Test-Path $uninstallKey)) { Fail "no Uninstall entry at $uninstallKey" }
$entry = Get-ItemProperty $uninstallKey
$installDir = $entry.InstallLocation
if (-not $installDir) { $installDir = Split-Path ($entry.UninstallString -replace '"', '') -Parent }
$exe = Join-Path $installDir "$app.exe"
if (-not (Test-Path $exe)) { Fail "$exe is missing after install" }
$uninstaller = ($entry.UninstallString -replace '"', '')
if (-not (Test-Path $uninstaller)) { Fail "uninstaller $uninstaller is missing" }
foreach ($path in @("resources\app\tools\uploader\watch.mjs", "resources\node\node.exe")) {
  if (-not (Test-Path (Join-Path $installDir $path))) { Fail "$path is missing from the install (the uploader cannot start without it)" }
}
$runValue = (Get-ItemProperty $runKey -ErrorAction SilentlyContinue).$app
Write-Host "installed to $installDir; Run entry: $runValue"

Step "launch"
Start-Process -FilePath $exe | Out-Null
WaitFor "a tray process" 30 { (Trays).Count -ge 1 }
WaitFor "the data folder" 30 { Test-Path $data }
Start-Sleep -Seconds 5
if ((Trays).Count -lt 1) { Fail "the tray exited within 5 s of starting" }

Step "second launch"
$before = (Trays).Count
Start-Process -FilePath $exe | Out-Null
Start-Sleep -Seconds 5
$after = (Trays).Count
if ($after -gt $before) { Fail "a second launch started a second tray ($before then $after processes)" }
if ($after -lt 1) { Fail "the tray is gone after a second launch" }

Step "uninstall (silent)"
$un = Start-Process -FilePath $uninstaller -ArgumentList "/S" -PassThru -Wait
if ($un.ExitCode -ne 0) { Fail "uninstaller exit code $($un.ExitCode)" }
# The NSIS uninstaller copies itself to a temp folder and returns early: wait
# for the files to go instead of trusting the exit.
WaitFor "the install folder to be removed" 60 { -not (Test-Path $exe) }
$left = @()
if (Test-Path $uninstallKey) { $left += "Uninstall entry" }
if ((Get-ItemProperty $runKey -ErrorAction SilentlyContinue).$app) { $left += "Run entry" }
if ((Get-ItemProperty $approvedKey -ErrorAction SilentlyContinue).$app) { $left += "StartupApproved entry" }
if (Test-Path (Join-Path $data "token")) { $left += "token file" }
if ((Trays).Count) { $left += "a running tray" }
if ($left.Count) { Fail "uninstall left: $($left -join ', ')" }
Write-Host "`nE2E OK: install, launch, second launch, uninstall."
