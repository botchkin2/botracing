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
$running = @(Get-ScheduledTask -TaskName 'Lap*' -ErrorAction SilentlyContinue |
  Where-Object State -eq 'Running')
if ($running) {
  if (Get-Process -Name 'Le Mans Ultimate' -ErrorAction SilentlyContinue) {
    throw 'LMU is running; not updating. Run this again after the session.'
  }
  $syncing = Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
    Where-Object { $_.CommandLine -like '*tools\sessions\sync.mjs*' }
  if ($syncing) { throw 'A sync is running; not updating. Run this again when it ends.' }
}
# Nobody should work in the clone, but never discard what someone left there.
if (Test-Path (Join-Path $Runtime '.git')) {
  $dirty = git -C $Runtime status --porcelain --untracked-files=no
  if ($dirty) {
    throw "$Runtime has local changes; not updating. Look at them, then clean it:`n$dirty"
  }
}
foreach ($task in $running) { Stop-ScheduledTask -TaskName $task.TaskName }
try {
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
}
finally {
  # Whatever happened, the tasks that were running run again.
  foreach ($task in $running) { Start-ScheduledTask -TaskName $task.TaskName }
}
$Runtime
