# The installer's guard for a lock that appears AFTER its waits (pit wall thread 100, ticket 10): the update
# rehearsal once failed with "Error opening file for writing: ...\botracing.exe" although both waits in hooks.nsh
# had found the exe free (no "waited" line in install.log). hooks.nsh now moves the old exe aside (botracing.exe.old)
# as the last step before the files are written; a rename works on a file something else holds open for reading
# (a scanner, the shell) and on a running image. CI ONLY: it installs BotRacing for the current user.
#
#   ./desktop/scripts/e2e-exe-late.ps1 -Installer <N setup.exe> -Scenario late|abort
#
# late:  a holder opens the exe (sharing Read and Delete, like a scanner) once the installer has logged that the exe
#        was free and is paused by its test seam (env BOTRACING_TEST_PAUSE_AFTER_CHECK, hooks.nsh). The install must finish, the
#        exe be replaced, and install.log say the old one was moved aside. A second install must then delete the
#        leftover .old without an error.
# abort: the installer fails on purpose after the move (env BOTRACING_TEST_FAIL_AFTER_MOVE). The old exe must be back,
#        unchanged, and start.
#
# Exits 1 with "EXE LATE E2E FAILED: ..." on any miss.
param(
  [Parameter(Mandatory = $true)][string]$Installer,
  [Parameter(Mandatory = $true)][ValidateSet('late', 'abort')][string]$Scenario
)
$ErrorActionPreference = "Stop"
if ($env:GITHUB_ACTIONS -ne 'true') { throw "e2e-exe-late.ps1 runs only on a CI runner (GITHUB_ACTIONS=true)" }
$app = "BotRacing"
$data = Join-Path $env:LOCALAPPDATA $app
$exe = Join-Path $data "botracing.exe"
$old = "$exe.old"
$installLog = Join-Path $data "install.log"
$trace = Join-Path $env:RUNNER_TEMP "exe-late-holder.log"
function Fail($message) {
  Write-Host "EXE LATE E2E FAILED ($Scenario): $message"
  if (Test-Path $trace) { Write-Host "-- holder"; Get-Content $trace }
  if (Test-Path $installLog) { Write-Host "-- install.log"; Get-Content $installLog -Tail 30 }
  exit 1
}
function Trays { @(Get-Process -Name $app -ErrorAction SilentlyContinue) }
function QuitTrays {
  if (Test-Path $exe) { & $exe --quit | Out-Null }
  $deadline = (Get-Date).AddSeconds(30)
  while ((Trays) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 250 }
  if (Trays) { Fail "the tray did not quit" }
}

# A clean slate: an install to update, no tray, no leftovers from an earlier scenario.
Remove-Item $old, $trace -ErrorAction SilentlyContinue
Remove-Item Env:BOTRACING_TEST_PAUSE_AFTER_CHECK, Env:BOTRACING_TEST_FAIL_AFTER_MOVE -ErrorAction SilentlyContinue
$p = Start-Process -FilePath $Installer -ArgumentList "/S" -Wait -PassThru
if ($p.ExitCode -ne 0) { Fail "first install exit code $($p.ExitCode)" }
if (-not (Test-Path $exe)) { Fail "no $exe after the first install" }
QuitTrays
Remove-Item $installLog, $old -ErrorAction SilentlyContinue
$before = [datetime]::new(2000, 1, 1, 0, 0, 0, [DateTimeKind]::Utc)
(Get-Item $exe).LastWriteTimeUtc = $before
$hashBefore = (Get-FileHash $exe -Algorithm SHA256).Hash

if ($Scenario -eq 'late') {
  $env:BOTRACING_TEST_PAUSE_AFTER_CHECK = "5000"
  # Hold the exe (read sharing only, delete allowed) once the installer is paused after its checks.
  $holder = Start-Job -ArgumentList $exe, $installLog, $trace -ScriptBlock {
    param($path, $log, $trace)
    $mark = { param($what) Add-Content $trace "$((Get-Date).ToString('HH:mm:ss.fff')) $what" }
    $deadline = (Get-Date).AddSeconds(90)
    while (-not ((Test-Path $log) -and (Select-String -Path $log -Pattern 'test seam PAUSE_AFTER_CHECK' -Quiet)) -and (Get-Date) -lt $deadline) {
      Start-Sleep -Milliseconds 50
    }
    & $mark 'paused seen'
    $fs = [IO.File]::Open($path, 'Open', 'Read', [IO.FileShare]'Read, Delete')
    & $mark 'taken'
    Start-Sleep -Seconds 12
    $fs.Close()
    & $mark 'released'
  }
} else {
  $env:BOTRACING_TEST_FAIL_AFTER_MOVE = "1"
}

$t0 = Get-Date
$p = Start-Process -FilePath $Installer -ArgumentList "/S" -Wait -PassThru
Remove-Item Env:BOTRACING_TEST_PAUSE_AFTER_CHECK, Env:BOTRACING_TEST_FAIL_AFTER_MOVE -ErrorAction SilentlyContinue
$secs =((Get-Date) - $t0).TotalSeconds
Write-Host "installer exit code $($p.ExitCode) after $([math]::Round($secs, 1)) s"
if (-not (Test-Path $installLog)) { Fail "no install.log" }
$log = Get-Content $installLog -Raw

if ($Scenario -eq 'late') {
  if (Test-Path $trace) { Get-Content $trace | ForEach-Object { Write-Host "holder: $_" } }
  if ($p.ExitCode -ne 0) { Fail "install under a late holder exit code $($p.ExitCode)" }
  if ($log -notmatch 'moved the old exe aside') { Fail "install.log has no 'moved the old exe aside'" }
  if ((Get-Item $exe).LastWriteTimeUtc -le $before) { Fail "the exe was not replaced" }
  if ((Get-FileHash $exe -Algorithm SHA256).Hash -eq $hashBefore) { Fail "the exe is still the old file" }
  Wait-Job $holder | Out-Null
  Receive-Job $holder -ErrorAction SilentlyContinue | Out-Null
  # A second install: the leftover .old (held until the first one finished) is deleted first, with no error.
  QuitTrays
  $p2 = Start-Process -FilePath $Installer -ArgumentList "/S" -Wait -PassThru
  if ($p2.ExitCode -ne 0) { Fail "second install exit code $($p2.ExitCode)" }
  QuitTrays
  if (Test-Path $old) { Fail "the leftover .old is still there after a second install" }
  Write-Host "EXE LATE E2E OK (late): the old exe was moved aside under a holder, replaced, and the leftover is gone after the next install."
} else {
  if ($p.ExitCode -eq 0) { Fail "the install was meant to fail and exited 0" }
  if ($log -notmatch 'install failed: the old exe is back') { Fail "install.log has no 'the old exe is back'" }
  if (-not (Test-Path $exe)) { Fail "no $exe after the failed install: the Start with Windows entry would start nothing" }
  if ((Get-FileHash $exe -Algorithm SHA256).Hash -ne $hashBefore) { Fail "the exe after the failed install is not the old one" }
  # It starts: the old tray is up for a few seconds, then quits.
  Start-Process -FilePath $exe | Out-Null
  $deadline = (Get-Date).AddSeconds(20)
  while (-not (Trays) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 250 }
  if (-not (Trays)) { Fail "the restored exe did not start" }
  Start-Sleep -Seconds 3
  if (-not (Trays)) { Fail "the restored exe started and ended within 3 s" }
  QuitTrays
  Write-Host "EXE LATE E2E OK (abort): the install failed after the move, the old exe is back unchanged and starts."
}
