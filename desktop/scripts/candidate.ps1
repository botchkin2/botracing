# "Release tray" (release-tray.yml): the one installer the run built, checked
# before a gate tests it or publish signs it. Prints its full path.
#
#   $setup = ./desktop/scripts/candidate.ps1 -Dir <download folder> -Sha256 <build's sha256>
#
# Exactly one -setup.exe, and its sha256 is the one `build` recorded: the exe
# every gate tested is the exe that ships, checked rather than assumed.
param(
  [Parameter(Mandatory)][string]$Dir,
  [Parameter(Mandatory)][string]$Sha256
)
$ErrorActionPreference = 'Stop'
$found = @(Get-ChildItem (Join-Path $Dir '*-setup.exe'))
if ($found.Count -ne 1) { throw "expected one -setup.exe in $Dir, found $($found.Count)" }
$got = (Get-FileHash $found[0].FullName -Algorithm SHA256).Hash.ToLowerInvariant()
if ($got -ne $Sha256.ToLowerInvariant()) { throw "$($found[0].Name) is $got, not the built candidate $Sha256" }
Write-Host "candidate $($found[0].Name) sha256 $got"
$found[0].FullName
