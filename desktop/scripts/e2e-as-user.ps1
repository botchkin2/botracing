# Runs e2e-install.ps1 as a NEW standard (non-admin) local user whose name has a
# space and non-ASCII letters ("Test Ünïcode"), so %LOCALAPPDATA% and the
# install folder have both, as on a PC whose owner typed their real name. For a
# CI runner only (it creates and deletes a local account).
#
#   .\desktop\scripts\e2e-as-user.ps1 -Installer <setup.exe> [-Node as-is|none|decoy]
param(
  [Parameter(Mandatory = $true)][string]$Installer,
  [ValidateSet("as-is", "none", "decoy")][string]$Node = "as-is",
  # unicode: "Test Ünïcode" (a space and non-ASCII letters); ascii: "e2euser", the
  # same standard user with a plain name, to tell the two causes apart.
  [ValidateSet("unicode", "ascii")][string]$Account = "unicode"
)
$ErrorActionPreference = "Stop"

# Built from code points so the file's own encoding cannot change the name.
$userName = if ($Account -eq "ascii") { "e2euser" } else { "Test " + [char]0x00DC + "n" + [char]0x00EF + "code" }
$password = ConvertTo-SecureString ([guid]::NewGuid().ToString("N") + "aA1!") -AsPlainText -Force
$work = "C:\e2e"

Write-Host "creating the standard user '$userName'"
New-LocalUser -Name $userName -Password $password -AccountNeverExpires -PasswordNeverExpires | Out-Null
Add-LocalGroupMember -SID "S-1-5-32-545" -Member $userName # Users; not Administrators
# A task can only run as a user who may "log on as a batch job"; Performance Log
# Users holds that right by default and gives no administrative rights.
Add-LocalGroupMember -SID "S-1-5-32-559" -Member $userName

New-Item -ItemType Directory -Force $work | Out-Null
Copy-Item $Installer (Join-Path $work "setup.exe") -Force
Copy-Item (Join-Path $PSScriptRoot "e2e-install.ps1") $work -Force
icacls $work /grant "*S-1-5-32-545:(OI)(CI)M" | Out-Null

$out = Join-Path $work "out.txt"
$exit = 1
$taskName = "botracing-e2e"
try {
  # A scheduled task logs the user on for real (profile, LOCALAPPDATA, their own
  # environment). Start-Process -Credential does not: the installer then saw no
  # LOCALAPPDATA and installed to "\BotRacing". Windows PowerShell 5.1: a PC has
  # no pwsh 7. The script's output goes to a file the task redirects to.
  $plain = [System.Net.NetworkCredential]::new("", $password).Password
  $command = "-NoProfile -ExecutionPolicy Bypass -Command `"& '$work\e2e-install.ps1' -Installer '$work\setup.exe' -Node $Node *> '$out'; exit `$LASTEXITCODE`""
  $action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $command -WorkingDirectory $work
  # -User/-Password and -Principal cannot be combined; Limited is the standard
  # token, which this user has anyway.
  Register-ScheduledTask -TaskName $taskName -Action $action -User "$env:COMPUTERNAME\$userName" -Password $plain -RunLevel Limited -Force | Out-Null
  Start-ScheduledTask -TaskName $taskName
  $until = (Get-Date).AddMinutes(12)
  $startedBy = (Get-Date).AddSeconds(90)
  # Right after Start the state is still Ready and the result 267011 (never
  # run), 267009 while it runs: it is done when it is Ready with a real result.
  do {
    Start-Sleep -Seconds 3
    $state = (Get-ScheduledTask -TaskName $taskName).State
    $result = (Get-ScheduledTaskInfo -TaskName $taskName).LastTaskResult
    if ($result -eq 267011 -and (Get-Date) -gt $startedBy) { break } # never started
  } while (($state -ne "Ready" -or $result -eq 267011 -or $result -eq 267009) -and (Get-Date) -lt $until)
  if ($result -eq 267011) {
    Write-Host "the task never started; state $state"
    Get-ScheduledTaskInfo -TaskName $taskName | Format-List | Out-String | Write-Host
    Get-WinEvent -LogName "Microsoft-Windows-TaskScheduler/Operational" -MaxEvents 15 -ErrorAction SilentlyContinue | ForEach-Object { Write-Host "  $($_.TimeCreated.ToString('T')) $($_.Id) $($_.Message -replace '\s+', ' ')" }
  }
  if ($state -ne "Ready") { Write-Host "the task did not finish in 12 minutes"; Stop-ScheduledTask -TaskName $taskName }
  $exit = $result
} finally {
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
  if (Test-Path $out) { Get-Content $out }
  Remove-LocalUser -Name $userName -ErrorAction SilentlyContinue
}
if ($exit -ne 0) { Write-Host "E2E FAILED as '$userName' (exit $exit)"; exit $exit }
Write-Host "E2E OK as '$userName'"
