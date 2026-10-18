# The installer's last guard, proven by construction (pit wall thread 71,
# plank #5643): botracing.exe is held open with no sharing until 3 s past the
# installer's preinstall hook, the way the exe stayed unwritable for a moment after the tray exited in the update
# rehearsal, and the installer must wait for it (hooks.nsh,
# BOTRACING_WAIT_TRAY_GONE: "waited N ms for the exe to be writable") instead of
# stopping on "Error opening file for writing". CI ONLY: it installs BotRacing
# for the current user.
#
#   ./desktop/scripts/e2e-exe-lock.ps1 -Installer <N setup.exe> [-HoldS 3]
#
# Exits 1 with "EXE LOCK E2E FAILED: ..." when the install fails, the exe was
# not replaced, or install.log shows no wait of at least HoldS - 1 s.
param(
  [Parameter(Mandatory = $true)][string]$Installer,
  [int]$HoldS = 3
)
$ErrorActionPreference = "Stop"
if ($env:GITHUB_ACTIONS -ne 'true') { throw "e2e-exe-lock.ps1 runs only on a CI runner (GITHUB_ACTIONS=true)" }
$app = "BotRacing"
$data = Join-Path $env:LOCALAPPDATA $app
$exe = Join-Path $data "botracing.exe"
$installLog = Join-Path $data "install.log"
function Fail($message) {
  Write-Host "EXE LOCK E2E FAILED: $message"
  $t = Join-Path $env:RUNNER_TEMP "exe-lock-holder.log"
  if (Test-Path $t) { Write-Host "-- holder"; Get-Content $t }
  if (Test-Path $installLog) { Write-Host "-- install.log"; Get-Content $installLog -Tail 20 }
  exit 1
}
function Trays { @(Get-Process -Name $app -ErrorAction SilentlyContinue) }

# An install to lock, and no tray holding it.
$p = Start-Process -FilePath $Installer -ArgumentList "/S" -Wait -PassThru
if ($p.ExitCode -ne 0) { Fail "first install exit code $($p.ExitCode)" }
if (-not (Test-Path $exe)) { Fail "no $exe after the first install" }
if (Trays) { & $exe --quit | Out-Null }
$deadline = (Get-Date).AddSeconds(30)
while ((Trays) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 250 }
if (Trays) { Fail "the tray did not quit before the lock" }
Remove-Item $installLog -ErrorAction SilentlyContinue
# NSIS stamps a file with its build time, so reinstalling the same build keeps
# the time: an old stamp here is what shows the install really wrote it.
$before = [datetime]::new(2000, 1, 1, 0, 0, 0, [DateTimeKind]::Utc)
(Get-Item $exe).LastWriteTimeUtc = $before

# Hold the exe with no sharing, from another process, and start the installer
# only once the hold is taken. The hold lasts HoldS seconds from the moment the
# installer's preinstall hook logs: counted from the installer's start, a slow
# runner's unpacking outlasted a 3 s hold and the guard never had to wait
# (#641's rehearsal, 2026-10-16).
$taken = Join-Path $env:RUNNER_TEMP "exe-lock-taken"
Remove-Item $taken -ErrorAction SilentlyContinue
$trace = Join-Path $env:RUNNER_TEMP "exe-lock-holder.log"
Remove-Item $trace -ErrorAction SilentlyContinue
$holder = Start-Job -ArgumentList $exe, $HoldS, $taken, $installLog, $trace -ScriptBlock {
  param($path, $secs, $flag, $log, $trace)
  $mark = { param($what) Add-Content $trace "$((Get-Date).ToString('HH:mm:ss.fff')) $what (pid $PID)" }
  $fs = [IO.File]::Open($path, 'Open', 'Read', 'None')
  & $mark 'taken'
  Set-Content $flag "taken"
  $deadline = (Get-Date).AddSeconds(60)
  while (-not ((Test-Path $log) -and (Select-String -Path $log -Pattern '^preinstall:' -Quiet)) -and (Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 100
  }
  & $mark 'preinstall seen'
  Start-Sleep -Seconds $secs
  $fs.Close()
  & $mark 'released'
}
$deadline = (Get-Date).AddSeconds(15)
while (-not (Test-Path $taken) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 50 }
if (-not (Test-Path $taken)) { Receive-Job $holder -ErrorAction SilentlyContinue; Fail "the lock was never taken" }

try { [IO.File]::Open($exe, 'Open', 'ReadWrite', 'None').Close(); Write-Host "probe: the exe is WRITABLE under the hold" } catch { Write-Host "probe: the exe is locked, as it should be" }
$t0 = Get-Date
Write-Host "installer start $($t0.ToString('HH:mm:ss.fff'))"
$p = Start-Process -FilePath $Installer -ArgumentList "/S" -Wait -PassThru
$secs = ((Get-Date) - $t0).TotalSeconds
Wait-Job $holder | Out-Null
# Without the installer's own wait, Tauri's Restart Manager step ends the
# holder (seen on main's hooks): that is a finding, not a script error.
if ($holder.State -ne 'Completed') { Write-Host "the holder was ended before it let go ($($holder.State))" }
Receive-Job $holder -ErrorAction SilentlyContinue
Write-Host "installer end $((Get-Date).ToString('HH:mm:ss.fff')), holder $($holder.State)"
if ($p.ExitCode -ne 0) { Fail "install under the lock exit code $($p.ExitCode) after $([int]$secs) s" }
if ((Get-Item $exe).LastWriteTimeUtc -le $before) { Fail "the exe was not replaced" }
if (-not (Test-Path $installLog)) { Fail "no install.log: the installer never waited for the exe" }
$wait = Select-String -Path $installLog -Pattern 'waited (\d+) ms for the exe to be writable' -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $wait) { Fail "install.log has no 'waited N ms for the exe to be writable'" }
$ms = [int]$wait.Matches[0].Groups[1].Value
if ($ms -lt ($HoldS - 1) * 1000) { Fail "the installer waited only $ms ms for a $HoldS s hold" }
Write-Host "EXE LOCK E2E OK: held $HoldS s, the installer waited $ms ms and replaced the exe ($([math]::Round($secs, 1)) s)."
