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
#   cleanup    a capture folder old enough to go, a stray file beside it in the
#              capture root (the recorders' status files sit there on a real PC)
#              and a fresh capture are planted before the first launch: the
#              tray's cleanup deletes the old one, leaves the stray file and the
#              fresh capture alone and reports no problem (ticket 86)
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
# class does not end in -sic and that is not click-through is one a user could see.
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
    [DllImport("user32.dll", EntryPoint = "GetWindowLongW")] static extern int GetWindowLong(IntPtr hwnd, int index);
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
        // The event loop's own helper ("Tao Thread Event Target", 15x15) is
        // "visible" but click-through (WS_EX_TRANSPARENT): measured on a running
        // tray, and on the runner, where it failed this check.
        int ex = GetWindowLong(hwnd, -20);
        if ((ex & 0x20) != 0) return true;
        var title = new StringBuilder(256);
        GetWindowTextW(hwnd, title, title.Capacity);
        found.Add("pid " + pid + " class " + cls + " title " + title + " exstyle " + ex.ToString("x"));
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

Step "window check self-test"
# A check that skips two kinds of window must be shown to still see a real one:
# a child process shows a plain form, and Visible has to report it.
$probe = Start-Process powershell.exe -PassThru -ArgumentList '-NoProfile', '-Command', 'Add-Type -AssemblyName System.Windows.Forms; $f = New-Object System.Windows.Forms.Form; $f.Show(); $t = Get-Date; while (((Get-Date) - $t).TotalSeconds -lt 30) { [System.Windows.Forms.Application]::DoEvents(); Start-Sleep -Milliseconds 100 }'
# A fixed pause was too short on one 2025 runner (the form had not opened):
# look for up to 20 s, and the child shows its form for 30.
$seen = @()
$until = (Get-Date).AddSeconds(20)
while ($seen.Count -lt 1 -and -not $probe.HasExited -and (Get-Date) -lt $until) {
  Start-Sleep -Milliseconds 500
  $seen = @([E2e.Wins]::Visible(@($probe.Id)))
}
if (-not $probe.HasExited) { $probe.Kill() }
# Session 0 (a scheduled task with a password, the standard-user cells) has no
# interactive desktop: not even a console window is visible there (measured on
# the runners), so the check can see nothing and proves nothing in that session.
$windowCheckApplies = $true
if ($seen.Count -ge 1) {
  Write-Host "window check sees a plain form: $($seen[0])"
} elseif ((Get-Process -Id $PID).SessionId -eq 0) {
  $windowCheckApplies = $false
  Write-Host "window check: n/a, session 0 shows no window to a check (a plain form was not seen)"
} else {
  Fail "the window check did not see a plain form: it would pass on a tray that opens a window"
}

Step "plant a capture root for the cleanup"
# What the recorder leaves in %LOCALAPPDATA%\lap-capture, and what the uploader's
# state says: an old finished capture whose sessions were read back from the
# store ("verified"), a fresh one, and a file in the root that is not a capture.
# Before the first launch, so the cleanup that runs at the tray's start sees it.
$capRoot = Join-Path $env:LOCALAPPDATA "lap-capture"
$oldCap = Join-Path $capRoot "2026-01-01T00-00-00Z_e2e-old-capture_10"
$newCap = Join-Path $capRoot "2099-01-01T00-00-00Z_e2e-fresh-capture_10"
$stray = Join-Path $capRoot "e2e-stray-note.txt"
New-Item -ItemType Directory -Force $oldCap, $newCap | Out-Null
foreach ($cap in @($oldCap, $newCap)) {
  Set-Content (Join-Path $cap "chunk.bin") "x" -Encoding ascii
  Set-Content (Join-Path $cap "meta.json") '{"sim":"lmu","endUtc":"2026-01-01T00:10:00Z"}' -Encoding ascii
  Set-Content (Join-Path $cap "uploaded.json") '{"sessionId":"s1","sessionIds":["s1"],"uploadedUtc":"2026-01-01T01:00:00Z","verified":{"s1":{"laps":3,"fieldHash":"abc","utc":"2026-01-01T01:00:00Z"}}}' -Encoding ascii
}
foreach ($file in (Get-ChildItem $oldCap -File)) { $file.LastWriteTime = (Get-Date).AddDays(-60) }
(Get-Item $oldCap).LastWriteTime = (Get-Date).AddDays(-60)
Set-Content $stray "not a capture" -Encoding ascii
Set-Content (Join-Path $capRoot "status.json") "{}" -Encoding ascii
$uploaderDir = Join-Path $data "uploader"
New-Item -ItemType Directory -Force $uploaderDir | Out-Null
# An uploader that ran yesterday and is idle: the cleanup may delete.
Set-Content (Join-Path $uploaderDir "state.json") ('{{"lastRunAtMs":{0},"syncing":false,"retries":{{}}}}' -f [DateTimeOffset]::UtcNow.AddDays(-1).ToUnixTimeMilliseconds()) -Encoding ascii

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

Step "cleanup"
# The tray's cleanup runs once at its start and logs one line to
# uploader\prune.log (capture/prune_schedule.rs).
$pruneLog = Join-Path $uploaderDir "prune.log"
WaitFor "the cleanup's log line" 60 { (Test-Path $pruneLog) -and ((Get-Content $pruneLog -Raw) -match "deleted \d+ captures") }
$pruneLine = @(Get-Content $pruneLog)[-1]
Write-Host "prune.log: $pruneLine"
if ($pruneLine -notmatch "deleted 1 captures") { Fail "the cleanup did not delete exactly the old capture: $pruneLine" }
if (Test-Path $oldCap) { Fail "the old, verified capture is still there after the cleanup" }
if (-not (Test-Path $newCap)) { Fail "the cleanup deleted the fresh capture" }
if (-not (Test-Path $stray)) { Fail "the cleanup removed a file that is not a capture" }
# main counted the status files and the stray file as captures that were "not stored yet".
if ($pruneLine -match "not stored yet|skipped by the cleanup") { Fail "the cleanup reported a problem for a file that is not a capture: $pruneLine" }
Write-Host "cleanup: the old capture went, the fresh one and the stray file stayed, no problem reported"

Step "second launch"
# The same exe reached three ways: the path, its 8.3 short name and the
# extended-length form (the 0.1.2 bug class: the app must not trust one spelling).
$forms = @(@{n = "path"; p = $exe}, @{n = "8.3 short name"; p = (ShortPath $exe)}, @{n = "extended-length"; p = "\\?\$exe"})
$firstPid = (Trays)[0].Id
foreach ($form in $forms) {
  Write-Host "second launch by $($form.n): $($form.p)"
  $second = Start-Process -FilePath $form.p -PassThru
  # A second launch hands over to the first tray and ends at once; one that
  # stays up is a second tray, and one that takes the first down is a replace.
  if (-not $second.WaitForExit(15000)) { Fail "the launch by $($form.n) is still running after 15 s: a second tray (pid $($second.Id))" }
  Start-Sleep -Seconds 2
  $now = @(Trays | ForEach-Object { $_.Id })
  if ($now.Count -ne 1 -or $now[0] -ne $firstPid) { Fail "after a launch by $($form.n) the trays are [$($now -join ', ')], not only the first (pid $firstPid)" }
}
if ($Node -eq "decoy" -and (Test-Path $decoyMarker)) { Fail "the node on PATH was run: the tray must use only its bundled node" }

Step "quit, then start the way Windows does at logon"
# `--quit` must stop the running tray (the uninstaller relies on the same call).
Diag "before --quit"
$quit = Start-Process -FilePath $exe -ArgumentList "--quit" -PassThru -Wait
Write-Host "--quit exit code $($quit.ExitCode)"
$until = (Get-Date).AddSeconds(20)
while ((Trays).Count -gt 0 -and (Get-Date) -lt $until) { Start-Sleep -Milliseconds 500 }
if ((Trays).Count -gt 0) {
  # Which route the quit took: the window message (same desktop) or the
  # quit-request file the tray polls (another session).
  Diag "after --quit, tray still up"
  Write-Host "data folder after --quit: $((Get-ChildItem $data -Force -ErrorAction SilentlyContinue | ForEach-Object { $_.Name }) -join ', ')"
  # The tray's own account of the quit (quit_tray in main.rs): the last line is
  # the step that hung; no file means the message never reached its loop.
  if (Test-Path (Join-Path $data "quit.log")) { Write-Host "quit.log:"; Get-Content (Join-Path $data "quit.log") | ForEach-Object { Write-Host "  $_" } } else { Write-Host "quit.log: none" }
  Fail "timed out after 20s waiting for: the tray to quit after --quit"
}
# Every cleanup step must be done before the process ends, by the event loop
# or by the tray's own exit 3 s later ("exit forced"): the forced exit is
# allowed, a missing step is not (thread 1 #4778). A quit while the window is
# still being built ends the process at once ("exit now: window still being
# built"): a WebView2 build holds the main thread for up to 9 s on
# windows-2022, and the loop would see the exit only after it (thread 1 #4955).
$quitLog = Join-Path $data "quit.log"
if (-not (Test-Path $quitLog)) { Fail "no quit.log: the quit never reached the tray" }
$quitLines = @(Get-Content $quitLog)
Write-Host "quit.log: $($quitLines -join ' | ')"
$exitAt = [array]::FindIndex([string[]]$quitLines, [Predicate[string]]{ param($l) $l -match '^(exit forced|event loop ended|exit now: window still being built)' })
# The tray ends itself one of two ways, and says which; anything else ended it.
if ($exitAt -lt 0) { Fail "quit.log has none of 'event loop ended', 'exit now', 'exit forced': something else ended the tray" }
foreach ($step in @("watcher stopped", "recorders stopped", "window state saved", "tray icon removed")) {
  $at = [array]::FindIndex([string[]]$quitLines, [Predicate[string]]{ param($l) $l -match "^$step " })
  if ($at -lt 0) { Fail "quit.log has no '$step': a quit must finish it before the tray ends" }
  if ($exitAt -ge 0 -and $at -gt $exitAt) { Fail "quit.log: '$step' came after the process was ending" }
}
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
$windows = if ($windowCheckApplies) { @([E2e.Wins]::Visible(@(Trays | ForEach-Object { $_.Id }))) } else { @() }
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
