# Registers the LapRecorder scheduled task: recorder.py at logon, headless
# (conhost --headless, as RaceWatch and LapUploader), below-normal priority,
# one instance. It runs from this checkout, so keep it on main.
#   Status: Get-Content $env:LOCALAPPDATA\lap-capture\status.json
#   Stop:   Stop-ScheduledTask LapRecorder
#   Remove: Unregister-ScheduledTask LapRecorder
$capture = (Resolve-Path $PSScriptRoot).Path
$uv = (Get-Command uv).Source
$recorder = Join-Path $capture 'recorder.py'
$action = New-ScheduledTaskAction -Execute 'conhost.exe' `
  -Argument "--headless `"$uv`" run --project `"$capture`" `"$recorder`"" `
  -WorkingDirectory $capture
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries -Priority 7
Register-ScheduledTask -TaskName 'LapRecorder' -Action $action `
  -Trigger $trigger -Settings $settings -Force `
  -Description 'Records LMU shared memory to local Parquet (tools/capture).'
Start-ScheduledTask -TaskName 'LapRecorder'
