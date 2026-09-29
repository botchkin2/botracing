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

$origin = (git -C $PSScriptRoot remote get-url origin).Trim()
if (-not (Test-Path (Join-Path $Runtime '.git'))) {
  Invoke-Checked 'git clone' { git clone --quiet $origin $Runtime }
}
# Nobody should work in the clone, but never discard what someone left there.
$dirty = git -C $Runtime status --porcelain --untracked-files=no
if ($dirty) {
  throw "$Runtime has local changes; not updating. Look at them, then clean it:`n$dirty"
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

# Restart running tasks so they load the new code, but never mid-race (that
# splits a capture) or mid-sync. Otherwise they pick it up at the next logon.
$game = Get-Process -Name 'Le Mans Ultimate' -ErrorAction SilentlyContinue
$syncing = Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -like '*tools\sessions\sync.mjs*' }
foreach ($task in Get-ScheduledTask -TaskName 'Lap*' -ErrorAction SilentlyContinue) {
  if ($task.State -ne 'Running') { continue }
  if ($game) { Write-Warning "$($task.TaskName): LMU is running; new code loads at next logon"; continue }
  if ($task.TaskName -eq 'LapUploader' -and $syncing) {
    Write-Warning 'LapUploader: a sync is running; new code loads at next logon'
    continue
  }
  Stop-ScheduledTask -TaskName $task.TaskName
  Start-ScheduledTask -TaskName $task.TaskName
}
$Runtime
