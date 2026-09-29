# Registers the LapUploader scheduled task: watch.mjs at logon, headless
# (conhost --headless, as RaceWatch), below-normal priority, one instance.
# It runs from this checkout, so keep it on main.
#   Stop:   Stop-ScheduledTask LapUploader
#   Remove: Unregister-ScheduledTask LapUploader
$repo = (Resolve-Path "$PSScriptRoot\..\..").Path
$node = (Get-Command node).Source
$watch = Join-Path $repo 'tools\uploader\watch.mjs'
$action = New-ScheduledTaskAction -Execute 'conhost.exe' `
  -Argument "--headless `"$node`" `"$watch`"" -WorkingDirectory $repo
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries -Priority 7
Register-ScheduledTask -TaskName 'LapUploader' -Action $action `
  -Trigger $trigger -Settings $settings -Force `
  -Description 'Syncs new LMU sessions to the lap app (tools/uploader).'
Start-ScheduledTask -TaskName 'LapUploader'
