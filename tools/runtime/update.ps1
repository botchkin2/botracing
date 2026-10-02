# Keeps the runtime clone that the logon tasks (LapUploader, LapRecorder) run
# from: C:\Users\Botkin\Projects\lap-runtime, pinned to origin/main. Sessions
# edit files and switch branches in the main checkout; that never changes
# what runs in the background (pitlane, thread 30 #538).
#   powershell -File tools\runtime\update.ps1
# Writes the clone's path as its last line of output.
param([string]$Runtime = 'C:\Users\Botkin\Projects\lap-runtime')
$ErrorActionPreference = 'Stop'

function Invoke-Checked([string]$what, [scriptblock]$command) {
  & $command
  if ($LASTEXITCODE -ne 0) { throw "$what failed (exit $LASTEXITCODE)" }
}

# Safety first, before touching anything: the tasks run from this clone, so
# resetting it or reinstalling its packages under them could break a loaded
# module mid-sync or split a capture mid-race (sector, pitlane #554/#556).
# If it isn't safe, change nothing and say so.
# What runs is found by process command line, not by task state: a task
# whose top process (conhost) was stopped reads Ready while the node or
# python under it keeps running the old code and holds the one-instance
# lock (grid, thread 30 #580).
$scripts = @{
  'LapUploader' = 'tools\uploader\watch.mjs'
  'LapRecorder' = 'tools\capture\recorder.py'
}
function Get-LapProcesses {
  $all = Get-CimInstance Win32_Process
  $roots = @($all | Where-Object {
    $cmd = $_.CommandLine
    $_.Name -in 'node.exe', 'python.exe', 'uv.exe', 'conhost.exe' -and
      $cmd -and ($scripts.Values | Where-Object { $cmd -like "*$_*" })
  })
  # Their children too: the sync under the watcher, python under uv.
  $ids = [System.Collections.Generic.HashSet[int]]::new()
  $queue = [System.Collections.Generic.Queue[int]]::new()
  foreach ($p in $roots) { [void]$ids.Add($p.ProcessId); $queue.Enqueue($p.ProcessId) }
  while ($queue.Count) {
    $parent = $queue.Dequeue()
    foreach ($c in $all | Where-Object ParentProcessId -eq $parent) {
      if ($ids.Add($c.ProcessId)) { $queue.Enqueue($c.ProcessId) }
    }
  }
  $all | Where-Object { $ids.Contains($_.ProcessId) }
}
function Stop-LapTasks([string[]]$names) {
  foreach ($name in $names) {
    Stop-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
  }
  foreach ($p in Get-LapProcesses) {
    Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
  }
  $deadline = (Get-Date).AddSeconds(15)
  while (Get-LapProcesses) {
    if ((Get-Date) -gt $deadline) { throw 'Lap processes did not stop; not updating.' }
    Start-Sleep -Milliseconds 300
  }
}

$procs = @(Get-LapProcesses)
# Restart what was running, by task or by an orphaned process.
$restart = @($scripts.Keys | Where-Object {
  $name = $_
  $task = Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
  ($task -and $task.State -eq 'Running') -or
    ($task -and ($procs | Where-Object { $_.CommandLine -like "*$($scripts[$name])*" }))
})
if ($procs) {
  if (Get-Process -Name 'Le Mans Ultimate' -ErrorAction SilentlyContinue) {
    throw 'LMU is running; not updating. Run this again after the session.'
  }
  if ($procs | Where-Object { $_.CommandLine -like '*tools\sessions\sync.mjs*' }) {
    throw 'A sync is running; not updating. Run this again when it ends.'
  }
}
# Nobody should work in the clone, but never discard what someone left there.
if (Test-Path (Join-Path $Runtime '.git')) {
  $dirty = git -C $Runtime status --porcelain --untracked-files=no
  if ($dirty) {
    throw "$Runtime has local changes; not updating. Look at them, then clean it:`n$dirty"
  }
}
# Set when the new code fails `sync.mjs --check`: the uploader is then left
# stopped instead of restarted on code that crashes (#223 wrote nothing for a
# night). The recorder does not run sync.mjs, so it restarts regardless.
$checkError = $null
try {
  # Inside the try: if the stop times out, finally still restarts the tasks.
  Stop-LapTasks $restart
  $origin = (git -C $PSScriptRoot remote get-url origin).Trim()
  if (-not (Test-Path (Join-Path $Runtime '.git'))) {
    Invoke-Checked 'git clone' { git clone --quiet $origin $Runtime }
  }
  Invoke-Checked 'git fetch' { git -C $Runtime fetch --quiet origin main }
  Invoke-Checked 'git reset' { git -C $Runtime reset --quiet --hard origin/main }

  # Only the functions packages: the sync imports firebase-admin from there,
  # and tools/sessions and src/analysis import nothing else outside node.
  # npm ci fails on lock drift, and that failure stops the update.
  Invoke-Checked 'npm ci (functions)' {
    npm ci --prefix (Join-Path $Runtime 'functions') --no-audit --no-fund --silent
  }
  $capture = Join-Path $Runtime 'tools\capture'
  if (Test-Path (Join-Path $capture 'pyproject.toml')) {
    Invoke-Checked 'uv sync (capture)' { uv sync --frozen --quiet --project $capture }
  }

  # The DuckDB CLI the sync uses is not in git. Keep a copy inside the clone
  # instead of relying on %TEMP%, which Windows may clean.
  $duck = Join-Path $Runtime 'tools\sessions\duckdb.exe'
  if (-not (Test-Path $duck)) {
    $found = @($env:DUCKDB, (Join-Path $env:LOCALAPPDATA 'Temp\duckdb-cli\duckdb.exe')) |
      Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
    if ($found) { Copy-Item $found $duck }
    else { Write-Warning "No duckdb.exe found; put one at $duck" }
  }

  # The gate before the uploader starts: every step of a sync before its first
  # write, over all sessions, on the code just installed. Takes about 2 min.
  # Always, not only when the uploader was running: a rollout that stops it
  # first and starts it by hand still gets the check.
  # Judged on the exit code only. Windows PowerShell 5.1 with Stop turns any
  # stderr line of a native command into a terminating NativeCommandError when
  # the caller redirects 2>&1, and node warns on stderr (MODULE_TYPELESS_PACKAGE_JSON)
  # even when the check passes (apex #2005).
  $was = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  # -1 unless node ran: a missing node must not pass on an earlier exit code.
  $code = -1
  $LASTEXITCODE = -1
  try { & node (Join-Path $Runtime 'tools\sessions\sync.mjs') --check; $code = $LASTEXITCODE }
  finally { $ErrorActionPreference = $was }
  if ($code -ne 0) { $checkError = "sync.mjs --check failed (exit $code)" }
}
finally {
  # Whatever happened, the tasks that were running run again.
  foreach ($name in $restart) {
    if ($checkError -and $name -eq 'LapUploader') { continue }
    Start-ScheduledTask -TaskName $name
  }
}
if ($checkError) {
  $restart = @($restart | Where-Object { $_ -ne 'LapUploader' })
  Write-Warning "$checkError. LapUploader is stopped and not restarted; fix origin/main (or revert) and run update.ps1 again."
}

# Starting a task does not prove it stayed up: LapRecorder once sat at Ready
# with no python a minute after an update (apex, thread 30 #741). Look again
# after a minute, retry a dead task once, and fail loudly if it stays dead.
function Test-TaskChildAlive([string]$name) {
  # The node/python child, not the conhost wrapper, which can outlive it.
  [bool](Get-LapProcesses | Where-Object {
    $_.Name -in 'node.exe', 'python.exe' -and $_.CommandLine -like "*$($scripts[$name])*"
  })
}
if ($restart) {
  Start-Sleep -Seconds 60
  $dead = @($restart | Where-Object { -not (Test-TaskChildAlive $_) })
  foreach ($name in $dead) {
    Write-Warning "$name is not running 60 s after the update; starting it again."
    Stop-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
    Start-ScheduledTask -TaskName $name
  }
  if ($dead) {
    Start-Sleep -Seconds 30
    $stillDead = @($dead | Where-Object { -not (Test-TaskChildAlive $_) })
    if ($stillDead) { throw "Not running after the update and a retry: $($stillDead -join ', ')" }
  }
}
if ($checkError) { throw "$checkError; LapUploader left stopped." }
$Runtime
