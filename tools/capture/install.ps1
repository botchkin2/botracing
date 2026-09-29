# Registers the LapRecorder scheduled task: recorder.py at logon, headless
# (conhost --headless, as RaceWatch and LapUploader), below-normal priority,
# one instance, restarted if it fails. It runs from the runtime clone
# (tools/runtime), not from this checkout. --frozen: a start never
# re-resolves or rewrites uv.lock.
#   Status: Get-Content $env:LOCALAPPDATA\lap-capture\status.json
#   Stop:   Stop-ScheduledTask LapRecorder
#   Remove: Unregister-ScheduledTask LapRecorder
$ErrorActionPreference = 'Stop'
$runtime = & (Join-Path $PSScriptRoot '..\runtime\update.ps1') | Select-Object -Last 1
$capture = Join-Path $runtime 'tools\capture'
$uv = (Get-Command uv).Source
$recorder = Join-Path $capture 'recorder.py'
$action = New-ScheduledTaskAction -Execute 'conhost.exe' `
  -Argument "--headless `"$uv`" run --frozen --project `"$capture`" `"$recorder`"" `
  -WorkingDirectory $capture
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries -Priority 7 `
  -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName 'LapRecorder' -Action $action `
  -Trigger $trigger -Settings $settings -Force `
  -Description 'Records LMU shared memory to local Parquet (tools/capture).' | Out-Null
# A running recorder keeps its code until update.ps1 restarts it between
# sessions or the next logon; only start it here if it is not running.
if ((Get-ScheduledTask -TaskName 'LapRecorder').State -ne 'Running') {
  Start-ScheduledTask -TaskName 'LapRecorder'
}
