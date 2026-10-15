# The update rehearsal (e2e-update.ps1) run N times on one CI runner, to catch
# a failure that shows about once in 28 runs (roadmap row 4, pit wall #5204)
# without rebuilding N-1 and N each time. CI ONLY, like e2e-update.ps1: it
# installs, kills and uninstalls BotRacing for the current user.
#
#   ./desktop/scripts/e2e-update-loop.ps1 -Runs 30 -Old .. -New .. -Signature .. -Version .. -Port .. -Out <dir>
#
# Each run's whole output goes to <Out>/run-<i>.log. The
# runner is reset before each run (installer, tray and test server ended, the
# install and its data removed) so every run starts clean. <Out>/summary.txt counts the
# failures by the wait that timed out ("UPDATE E2E FAILED: ..."), and the runs in
# which the installer waited for the exiting tray (install.log, hooks.nsh
# BOTRACING_WAIT_TRAY_GONE), so a green loop shows the race it would have lost.
# Exits 1 when any run failed.
param(
  [Parameter(Mandatory = $true)][int]$Runs,
  [Parameter(Mandatory = $true)][string]$Old,
  [Parameter(Mandatory = $true)][string]$New,
  [Parameter(Mandatory = $true)][string]$Signature,
  [Parameter(Mandatory = $true)][string]$Version,
  [Parameter(Mandatory = $true)][int]$Port,
  [Parameter(Mandatory = $true)][string]$Out
)
# It ends processes and removes an install: never on a real PC.
if ($env:GITHUB_ACTIONS -ne 'true') { throw "e2e-update-loop.ps1 runs only on a CI runner (GITHUB_ACTIONS=true)" }
$app = "BotRacing"
$uninstallKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$app"
$data = Join-Path $env:LOCALAPPDATA $app
New-Item -ItemType Directory -Force $Out | Out-Null

function Reset-Runner {
  Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -match '^BotRacing' -or $_.Name -match 'setup\.exe$' -or ($_.Name -match '^python' -and $_.CommandLine -match "http\.server\s+$Port") } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  if (Test-Path $uninstallKey) {
    $u = (Get-ItemProperty $uninstallKey).UninstallString -replace '"', ''
    if ($u -and (Test-Path $u)) { Start-Process -FilePath $u -ArgumentList "/S" -Wait -ErrorAction SilentlyContinue }
    Remove-Item $uninstallKey -Recurse -Force -ErrorAction SilentlyContinue
  }
  Remove-Item $data -Recurse -Force -ErrorAction SilentlyContinue
  Remove-ItemProperty "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run" -Name $app -ErrorAction SilentlyContinue
}

$failures = @{}
$waited = @()
$started = Get-Date
for ($i = 1; $i -le $Runs; $i++) {
  # Clean before every run: a passing run's uninstall keeps the data folder
  # (the user's), which e2e-update.ps1 refuses to start over.
  Reset-Runner
  $log = Join-Path $Out ("run-{0:d2}.log" -f $i)
  $t0 = Get-Date
  & pwsh -NoProfile -File (Join-Path $PSScriptRoot "e2e-update.ps1") -Old $Old -New $New -Signature $Signature -Version $Version -Port $Port *> $log
  $code = $LASTEXITCODE
  $secs = [int]((Get-Date) - $t0).TotalSeconds
  # Read before the next reset removes the data folder.
  $wait = Select-String -Path (Join-Path $data "install.log") -Pattern '^(waited \d+ ms|tray still running).*' -ErrorAction SilentlyContinue |
    ForEach-Object { $_.Line }
  if ($wait) { $waited += "run $($i): $($wait -join '; ')"; Write-Host ("run {0}: installer {1}" -f $i, ($wait -join '; ')) }
  if ($code -eq 0) {
    Write-Host ("run {0}: ok ({1}s)" -f $i, $secs)
    Remove-Item $log
    continue
  }
  $why = (Select-String -Path $log -Pattern '^UPDATE E2E FAILED: (.*)$' | Select-Object -First 1).Matches.Groups[1].Value
  if (-not $why) { $why = "exit $code with no FAILED line" }
  # One bucket per wait, the version and pid in it made general.
  $kind = $why -replace 'pid \d+', 'pid N' -replace '\d+\.\d+\.\d+', 'X'
  $failures[$kind] = 1 + [int]$failures[$kind]
  Write-Host ("run {0}: FAILED ({1}s): {2}" -f $i, $secs, $why)
}

$failed = ($failures.Values | Measure-Object -Sum).Sum
$summary = @("runs: $Runs, failed: $([int]$failed), minutes: $([int]((Get-Date) - $started).TotalMinutes)")
foreach ($k in $failures.Keys) { $summary += "$($failures[$k]) x $k" }
$summary += "installer waited for the tray in $($waited.Count) runs"
$summary += $waited
$summary | Set-Content (Join-Path $Out "summary.txt")
$summary | ForEach-Object { Write-Host $_ }
if ($failed) { exit 1 }
