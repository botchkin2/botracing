# Runs e2e-install.ps1 as a NEW standard (non-admin) local user whose name has a
# space and non-ASCII letters ("Test Ünïcode"), so %LOCALAPPDATA% and the
# install folder have both, as on a PC whose owner typed their real name. For a
# CI runner only (it creates and deletes a local account).
#
#   .\desktop\scripts\e2e-as-user.ps1 -Installer <setup.exe> [-Node as-is|none|decoy]
param(
  [Parameter(Mandatory = $true)][string]$Installer,
  [ValidateSet("as-is", "none", "decoy")][string]$Node = "as-is"
)
$ErrorActionPreference = "Stop"

# Built from code points so the file's own encoding cannot change the name.
$name = "Test " + [char]0x00DC + "n" + [char]0x00EF + "code"
$password = ConvertTo-SecureString ([guid]::NewGuid().ToString("N") + "aA1!") -AsPlainText -Force
$work = "C:\e2e"

Write-Host "creating the standard user '$name'"
New-LocalUser -Name $name -Password $password -AccountNeverExpires -PasswordNeverExpires | Out-Null
Add-LocalGroupMember -SID "S-1-5-32-545" -Member $name # Users; not Administrators

New-Item -ItemType Directory -Force $work | Out-Null
Copy-Item $Installer (Join-Path $work "setup.exe") -Force
Copy-Item (Join-Path $PSScriptRoot "e2e-install.ps1") $work -Force
icacls $work /grant "*S-1-5-32-545:(OI)(CI)M" | Out-Null

$out = Join-Path $work "out.txt"
$err = Join-Path $work "err.txt"
$credential = New-Object System.Management.Automation.PSCredential(".\$name", $password)
$exit = 1
try {
  # Windows PowerShell 5.1: the script must run there too (a PC has no pwsh 7).
  $p = Start-Process -FilePath "powershell.exe" -Credential $credential -LoadUserProfile `
    -WorkingDirectory $work -PassThru -Wait -WindowStyle Hidden `
    -RedirectStandardOutput $out -RedirectStandardError $err `
    -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", (Join-Path $work "e2e-install.ps1"), "-Installer", (Join-Path $work "setup.exe"), "-Node", $Node)
  $exit = $p.ExitCode
} finally {
  if (Test-Path $out) { Get-Content $out -Encoding UTF8 }
  if (Test-Path $err) { Get-Content $err -Encoding UTF8 | ForEach-Object { Write-Host "stderr: $_" } }
  Remove-LocalUser -Name $name -ErrorAction SilentlyContinue
}
if ($exit -ne 0) { Write-Host "E2E FAILED as '$name' (exit $exit)"; exit $exit }
Write-Host "E2E OK as '$name'"
