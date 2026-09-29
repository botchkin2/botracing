# Registers the LapUploader scheduled task: watch.mjs at logon, headless
# (conhost --headless, as RaceWatch), below-normal priority, one instance,
# restarted if it fails. It runs from the runtime clone (tools/runtime), not
# from this checkout.
#   Stop:   Stop-ScheduledTask LapUploader
#   Remove: Unregister-ScheduledTask LapUploader
$ErrorActionPreference = 'Stop'
$runtime = & (Join-Path $PSScriptRoot '..\runtime\update.ps1') | Select-Object -Last 1
$node = (Get-Command node).Source
$watch = Join-Path $runtime 'tools\uploader\watch.mjs'
$action = New-ScheduledTaskAction -Execute 'conhost.exe' `
  -Argument "--headless `"$node`" `"$watch`"" -WorkingDirectory $runtime
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries -Priority 7 `
  -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName 'LapUploader' -Action $action `
  -Trigger $trigger -Settings $settings -Force `
  -Description 'Syncs new LMU sessions to the lap app (tools/uploader).' | Out-Null
# A running task keeps its code until update.ps1 restarts it safely or the
# next logon; only start it here if it is not running.
if ((Get-ScheduledTask -TaskName 'LapUploader').State -ne 'Running') {
  Start-ScheduledTask -TaskName 'LapUploader'
}
