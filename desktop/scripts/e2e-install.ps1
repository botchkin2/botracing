# End-to-end check of the built tray installer, for a CLEAN Windows runner
# (.github/workflows/tray-e2e.yml). It installs the real installer, starts the
# real tray, starts it a second time, and uninstalls it, and fails with the
# step that broke.
#
#   .\desktop\scripts\e2e-install.ps1 -Installer <path to *-setup.exe>
#
# NEVER run it on a PC that has BotRacing installed: it installs over it and the
# installer quits the running tray. It refuses when it finds an install.
#
# What each phase proves:
#   install    the per-user silent install puts BotRacing.exe where the Uninstall
#              entry says, and creates the Start with Windows entry (HKCU Run)
#   launch     the tray starts and stays up, and its data folder appears
#   second     a second launch does not add a second tray (single instance)
#   uninstall  the uninstaller removes the install folder, the Run entry, the
#              StartupApproved entry and the token file, and no tray is left
#
# Left to the phases that need a signed-in run (pit wall thread 1 #3462): the
# uploader starting and a heartbeat landing, and the second launch opening the
# desktop window. They are added here, not in a second script.
param(
  [Parameter(Mandatory = $true)][string]$Installer,
  # as-is: the PATH the runner has. none: no folder with a node.exe on PATH, so
  # only the bundled node can run. decoy: as none, plus a node on PATH that
  # records that it ran; the tray must never use it.
  [ValidateSet("as-is", "none", "decoy")][string]$Node = "as-is"
)
$ErrorActionPreference = "Stop"

$app = "BotRacing"
$uninstallKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$app"
$runKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
$approvedKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run"
$data = Join-Path $env:LOCALAPPDATA $app

function ShortPath($path) {
  (New-Object -ComObject Scripting.FileSystemObject).GetFile($path).ShortPath
}
function Step($name) { Write-Host "`n== $name" }
function Fail($message) {
  Write-Host "E2E FAILED: $message"
  if (Test-Path $data) {
    Write-Host "-- $data"
    Get-ChildItem $data -Recurse -File -ErrorAction SilentlyContinue | ForEach-Object { Write-Host "   $($_.FullName.Substring($data.Length)) ($($_.Length) bytes)" }
    foreach ($log in @("install.log", "uploader\sidecar.log")) {
      $file = Join-Path $data $log
      if (Test-Path $file) { Write-Host "-- $log"; Get-Content $file -Tail 40 }
    }
  }
  exit 1
}
# What the single-instance hold looks like from this process (tauri-plugin-
# single-instance, windows): a mutex named <identifier>-sim, per session, and a
# hidden window <identifier>-sic / <identifier>-siw that a second launch finds
# with FindWindowW on ITS OWN desktop. A quit that cannot see the window exits
# quietly and the tray stays (damper, pit wall thread 1 #3607).
Add-Type -Namespace E2e -Name U32 -MemberDefinition '[DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr FindWindowW(string cls, string title);'
function Diag($when) {
  $id = "app.botracing.uploader"
  $window = [E2e.U32]::FindWindowW("$id-sic", "$id-siw")
  $mutex = $null
  $mutexThere = [System.Threading.Mutex]::TryOpenExisting("$id-sim", [ref]$mutex)
  if ($mutex) { $mutex.Dispose() }
  $mine = (Get-Process -Id $PID).SessionId
  $trays = (Get-Process -Name $app -ErrorAction SilentlyContinue | ForEach-Object { "pid $($_.Id) session $($_.SessionId)" }) -join "; "
  Write-Host "diag ($when): FindWindow($id-sic) = $window; mutex $id-sim exists = $mutexThere; this script session $mine; trays: $trays"
}
# The windows a process owns, found with EnumWindows. Process.MainWindowTitle is
# not it: it returns the single-instance hidden window (class <identifier>-sic,
# title <identifier>-siw), which is never shown. Only a visible window whose
# class does not end in -sic is one a user could see.
Add-Type -Language CSharp -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
namespace E2e {
  public static class Wins {
    delegate bool EnumProc(IntPtr hwnd, IntPtr lParam);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc proc, IntPtr lParam);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassNameW(IntPtr hwnd, StringBuilder cls, int max);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowTextW(IntPtr hwnd, StringBuilder text, int max);
    public static string[] Visible(int[] pids) {
      var found = new List<string>();
      var wanted = new HashSet<int>(pids);
      EnumWindows((hwnd, _) => {
        uint pid;
        GetWindowThreadProcessId(hwnd, out pid);
        if (!wanted.Contains((int)pid) || !IsWindowVisible(hwnd)) return true;
        var cls = new StringBuilder(256);
        GetClassNameW(hwnd, cls, cls.Capacity);
        if (cls.ToString().EndsWith("-sic")) return true;
        var title = new StringBuilder(256);
        GetWindowTextW(hwnd, title, title.Capacity);
        found.Add("pid " + pid + " class " + cls + " title " + title);
        return true;
      }, IntPtr.Zero);
      return found.ToArray();
    }
  }
}
'@
function Trays { @(Get-Process -Name $app -ErrorAction SilentlyContinue) }
function WaitFor($what, $seconds, [scriptblock]$test) {
  $until = (Get-Date).AddSeconds($seconds)
  while ((Get-Date) -lt $until) {
    if (& $test) { return }
    Start-Sleep -Milliseconds 500
  }
  Fail "timed out after ${seconds}s waiting for: $what"
}

if (-not (Test-Path $Installer)) { Fail "no installer at $Installer" }
if ((Test-Path $uninstallKey) -or (Test-Path $data) -or (Trays).Count) {
  Fail "$app is already installed or running here: run this only on a clean runner"
}

$decoyMarker = Join-Path $env:TEMP "decoy-node-ran.txt"
if ($Node -ne "as-is") {
  $env:Path = (($env:Path -split ";") | Where-Object { $_ -and -not (Test-Path (Join-Path $_ "node.exe")) }) -join ";"
  if (Get-Command node -ErrorAction SilentlyContinue) { Fail "node is still on PATH: $((Get-Command node).Source)" }
}
if ($Node -eq "decoy") {
  $decoy = Join-Path $env:TEMP "decoy-node"
  New-Item -ItemType Directory -Force $decoy | Out-Null
  Set-Content (Join-Path $decoy "node.cmd") "@echo off$([Environment]::NewLine)echo ran > ""$decoyMarker"""
  $env:Path = "$decoy;$env:Path"
}
Write-Host "user: $env:USERNAME; LOCALAPPDATA: $env:LOCALAPPDATA; admin: $(([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)); node: $Node"

Step "install (silent, per user)"
$proc = Start-Process -FilePath $Installer -ArgumentList "/S" -PassThru -Wait
if ($proc.ExitCode -ne 0) { Fail "installer exit code $($proc.ExitCode)" }
if (-not (Test-Path $uninstallKey)) { Fail "no Uninstall entry at $uninstallKey" }
$entry = Get-ItemProperty $uninstallKey
Write-Host "Uninstall entry: InstallLocation=$($entry.InstallLocation) UninstallString=$($entry.UninstallString)"
# NSIS writes both values quoted.
$installDir = $entry.InstallLocation -replace '"', ''
if (-not $installDir) { $installDir = Split-Path ($entry.UninstallString -replace '"', '') -Parent }
$exe = Join-Path $installDir "$app.exe"
if (-not (Test-Path $exe)) { Fail "$exe is missing after install" }
$uninstaller = ($entry.UninstallString -replace '"', '')
if (-not (Test-Path $uninstaller)) { Fail "uninstaller $uninstaller is missing" }
foreach ($path in @("app\tools\uploader\watch.mjs", "node\node.exe")) {
  if (-not (Test-Path (Join-Path $installDir $path))) { Fail "$path is missing from the install (the uploader cannot start without it)" }
}
$runValue = (Get-ItemProperty $runKey -ErrorAction SilentlyContinue).$app
Write-Host "installed to $installDir; Run entry: $runValue"

Step "launch"
Start-Process -FilePath $exe | Out-Null
WaitFor "a tray process" 30 { (Trays).Count -ge 1 }
WaitFor "the data folder" 30 { Test-Path $data }
Start-Sleep -Seconds 5
if ((Trays).Count -lt 1) { Fail "the tray exited within 5 s of starting" }
Diag "after launch"
# Start with Windows is written by the tray on its first run (on by default).
WaitFor "the Start with Windows entry (HKCU Run)" 30 { (Get-ItemProperty $runKey -ErrorAction SilentlyContinue).$app }
$runValue = (Get-ItemProperty $runKey).$app
if ($runValue -notlike "*$app.exe*") { Fail "the Run entry does not name $app.exe: $runValue" }
Write-Host "Run entry: $runValue"

Step "second launch"
# The same exe reached three ways: the path, its 8.3 short name and the
# extended-length form (the 0.1.2 bug class: the app must not trust one spelling).
$forms = @(@{n = "path"; p = $exe}, @{n = "8.3 short name"; p = (ShortPath $exe)}, @{n = "extended-length"; p = "\\?\$exe"})
foreach ($form in $forms) {
  $before = (Trays).Count
  Write-Host "second launch by $($form.n): $($form.p)"
  Start-Process -FilePath $form.p | Out-Null
  Start-Sleep -Seconds 4
  $after = (Trays).Count
  if ($after -gt $before) { Fail "a launch by $($form.n) started another tray ($before then $after processes)" }
  if ($after -lt 1) { Fail "the tray is gone after a launch by $($form.n)" }
}
if ($Node -eq "decoy" -and (Test-Path $decoyMarker)) { Fail "the node on PATH was run: the tray must use only its bundled node" }

Step "quit, then start the way Windows does at logon"
# `--quit` must stop the running tray (the uninstaller relies on the same call).
Start-Process -FilePath $exe -ArgumentList "--quit" -Wait
WaitFor "the tray to quit after --quit" 20 { (Trays).Count -eq 0 }
# What Windows runs at logon is the Run value's command line. Run exactly that
# (a real sign-out and sign-in cannot be done on a runner; that is proven once on
# a real PC): one tray, and no window, because the tray lives in the notification
# area and opens its window only when asked.
$run = (Get-ItemProperty $runKey).$app
$quoted = [regex]::Match($run, '^"([^"]+)"(.*)$')
$runExe = if ($quoted.Success) { $quoted.Groups[1].Value } else { ($run -split " ")[0] }
$runArgs = if ($quoted.Success) { $quoted.Groups[2].Value.Trim() } else { "" }
Write-Host "starting the Run entry: $run"
if ($runArgs) { Start-Process -FilePath $runExe -ArgumentList $runArgs | Out-Null } else { Start-Process -FilePath $runExe | Out-Null }
WaitFor "the tray to start from the Run entry" 30 { (Trays).Count -ge 1 }
Start-Sleep -Seconds 6
$windows = @([E2e.Wins]::Visible(@(Trays | ForEach-Object { $_.Id })))
if ($windows.Count) {
  Fail ("the tray opened a window at a logon start: " + ($windows -join "; "))
}
if ((Trays).Count -ne 1) { Fail "a logon start left $((Trays).Count) trays, not 1" }
Write-Host "logon start: one tray, no window"

Step "uninstall (silent)"
$un = Start-Process -FilePath $uninstaller -ArgumentList "/S" -PassThru -Wait
if ($un.ExitCode -ne 0) { Fail "uninstaller exit code $($un.ExitCode)" }
# The NSIS uninstaller copies itself to a temp folder and returns early: wait
# for the files to go instead of trusting the exit.
$until = (Get-Date).AddSeconds(60)
while ((Test-Path $exe) -and (Get-Date) -lt $until) { Start-Sleep -Milliseconds 500 }
if (Test-Path $exe) {
  # Say why before failing: a tray still running keeps its exe locked, and the
  # uninstaller only stops it by running `exe --quit` (installer hook).
  Write-Host "after the uninstall $exe is still there"
  Write-Host "BotRacing processes: $((Trays | ForEach-Object { "$($_.Id) $($_.Path)" }) -join '; ')"
  Diag "before the manual --quit"
  Write-Host "trying '$exe --quit' by hand"
  Start-Process -FilePath $exe -ArgumentList "--quit" -Wait
  Start-Sleep -Seconds 8
  Write-Host "after a manual --quit, trays running: $((Trays).Count)"
  Fail "the uninstaller left $exe (see above)"
}
$left = @()
if (Test-Path $uninstallKey) { $left += "Uninstall entry" }
if ((Get-ItemProperty $runKey -ErrorAction SilentlyContinue).$app) { $left += "Run entry" }
if ((Get-ItemProperty $approvedKey -ErrorAction SilentlyContinue).$app) { $left += "StartupApproved entry" }
if (Test-Path (Join-Path $data "token")) { $left += "token file" }
if ((Trays).Count) { $left += "a running tray" }
if ($left.Count) { Fail "uninstall left: $($left -join ', ')" }
Write-Host "`nE2E OK: install, launch, second launch, uninstall."
