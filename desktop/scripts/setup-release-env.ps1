# Sets up the GitHub Environment that the tray release job runs in
# (.github/workflows/tray-release.yml). For Botkin to run once, from anywhere:
#
#   .\desktop\scripts\setup-release-env.ps1            create it and set what is on this PC
#   .\desktop\scripts\setup-release-env.ps1 -DryRun    show what it would do, change nothing
#
# It creates the Environment `tray-release` with Botkin (the signed-in `gh`
# user) as the required reviewer, deployable from `tray-v*` tags only, and sets
# its secrets from files already on this PC. It prints what it did and never a
# secret's value. It is safe to run again: it replaces the secrets and fixes
# the rules.
#
# Needs: `gh` signed in as the repo owner (gh auth status).
# Reads:
#   ~\.botracing\updater.key, updater.key.password   the updater signing key
#                                                    (made by `tauri signer generate`)
#   ~\.botracing\oauth-desktop.json                  the Google "desktop app" OAuth client
#                                                    JSON (-ClientFile to give another path)
#   the Firebase web key: -FirebaseApiKey, or the public one in src\auth\firebase.web.ts
#   -ServiceAccountFile (optional)                   a service account key JSON that may write
#                                                    to the botracing-61-lmu bucket. Without it
#                                                    the release job falls back to the repo-level
#                                                    FIREBASE_SERVICE_ACCOUNT_BOTRACING_61.
#
# BACK UP ~\.botracing\updater.key AND updater.key.password in your password
# manager: lose them and installed trays can no longer update.
param(
  [string]$Repo,
  [string]$ClientFile = (Join-Path $env:USERPROFILE ".botracing\oauth-desktop.json"),
  [string]$FirebaseApiKey = $env:BOTRACING_FIREBASE_API_KEY,
  [string]$ServiceAccountFile,
  [switch]$DryRun
)
$ErrorActionPreference = "Stop"
$EnvName = "tray-release"
$botracing = Join-Path $env:USERPROFILE ".botracing"
$repoRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent

function Fail($message) { Write-Host "STOP: $message" -ForegroundColor Red; exit 1 }
function Step($message) { Write-Host $(if ($DryRun) { "[dry run] $message" } else { $message }) }

if (-not (Get-Command gh -ErrorAction SilentlyContinue)) { Fail "gh (GitHub CLI) is not installed" }
gh auth status *> $null
if ($LASTEXITCODE -ne 0) { Fail "gh is not signed in: run gh auth login" }
if (-not $Repo) { $Repo = (gh repo view --json nameWithOwner --jq .nameWithOwner) }
if (-not $Repo) { Fail "could not tell which repo: pass -Repo owner/name" }

# --- the values, read now so a missing file stops the script before it changes anything
$values = [ordered]@{}
$missing = @()

$keyFile = Join-Path $botracing "updater.key"
$pwFile = Join-Path $botracing "updater.key.password"
if ((Test-Path $keyFile) -and (Test-Path $pwFile)) {
  $values["TAURI_SIGNING_PRIVATE_KEY"] = (Get-Content $keyFile -Raw).Trim()
  $values["TAURI_SIGNING_PRIVATE_KEY_PASSWORD"] = (Get-Content $pwFile -Raw).Trim()
} else {
  $missing += "the updater key ($keyFile and $pwFile)"
}

if (Test-Path $ClientFile) {
  $json = Get-Content $ClientFile -Raw | ConvertFrom-Json
  $client = if ($json.installed) { $json.installed } else { $json }
  if ($client.client_id -and $client.client_secret) {
    $values["BOTRACING_OAUTH_CLIENT_ID"] = $client.client_id
    $values["BOTRACING_OAUTH_CLIENT_SECRET"] = $client.client_secret
  } else {
    $missing += "client_id and client_secret in $ClientFile"
  }
} else {
  $missing += "the Google desktop OAuth client JSON ($ClientFile; download it from Google Cloud console > APIs & Services > Credentials)"
}

if (-not $FirebaseApiKey) {
  $webConfig = Join-Path $repoRoot "src\auth\firebase.web.ts"
  if (Test-Path $webConfig) {
    $m = [regex]::Match((Get-Content $webConfig -Raw), "apiKey:\s*'([^']+)'")
    if ($m.Success) { $FirebaseApiKey = $m.Groups[1].Value }
  }
}
if ($FirebaseApiKey) { $values["BOTRACING_FIREBASE_API_KEY"] = $FirebaseApiKey }
else { $missing += "the Firebase web API key (-FirebaseApiKey)" }

if ($ServiceAccountFile) {
  if (Test-Path $ServiceAccountFile) {
    $values["FIREBASE_SERVICE_ACCOUNT_BOTRACING_61"] = (Get-Content $ServiceAccountFile -Raw).Trim()
  } else { $missing += "the service account file ($ServiceAccountFile)" }
}

if ($missing.Count -gt 0) {
  Write-Host "Missing, nothing was changed:" -ForegroundColor Yellow
  $missing | ForEach-Object { Write-Host "  - $_" }
  exit 1
}

# --- the Environment: Botkin reviews, and only tray-v* tags may deploy to it
$userId = gh api user --jq .id
$login = gh api user --jq .login
Step "Environment '$EnvName' on ${Repo}: required reviewer $login, deployable from tags tray-v* only"
if (-not $DryRun) {
  $body = @{
    wait_timer = 0
    prevent_self_review = $false   # Botkin is also the one who tags
    reviewers = @(@{type = "User"; id = [int]$userId})
    deployment_branch_policy = @{protected_branches = $false; custom_branch_policies = $true}
  } | ConvertTo-Json -Depth 5
  $tmp = New-TemporaryFile
  try {
    Set-Content $tmp $body
    gh api -X PUT "repos/$Repo/environments/$EnvName" --input $tmp *> $null
    if ($LASTEXITCODE -ne 0) { Fail "could not create the Environment (does this account own $Repo?)" }

    # Only a tray-v* tag rule: drop any other policy, add the tag rule if absent.
    $policies = gh api "repos/$Repo/environments/$EnvName/deployment-branch-policies" --jq '.branch_policies[] | [.id, .name, .type] | @tsv'
    $haveTag = $false
    foreach ($line in $policies) {
      if (-not $line) { continue }
      $id, $name, $type = $line -split "`t"
      if ($name -eq "tray-v*" -and $type -eq "tag") { $haveTag = $true }
      else { gh api -X DELETE "repos/$Repo/environments/$EnvName/deployment-branch-policies/$id" *> $null }
    }
    if (-not $haveTag) {
      Set-Content $tmp (@{name = "tray-v*"; type = "tag"} | ConvertTo-Json)
      gh api -X POST "repos/$Repo/environments/$EnvName/deployment-branch-policies" --input $tmp *> $null
      if ($LASTEXITCODE -ne 0) { Fail "could not add the tray-v* tag rule" }
    }
  } finally { Remove-Item $tmp -Force -ErrorAction SilentlyContinue }
}

# --- the secrets: each value goes to gh on stdin from a temporary file, never on a command line
foreach ($name in $values.Keys) {
  Step "secret $name ($($values[$name].Length) characters)"
  if ($DryRun) { continue }
  $tmp = New-TemporaryFile
  try {
    [System.IO.File]::WriteAllText($tmp, $values[$name])
    $p = Start-Process gh -ArgumentList @("secret", "set", $name, "--env", $EnvName, "--repo", $Repo) `
      -RedirectStandardInput $tmp -NoNewWindow -Wait -PassThru
    if ($p.ExitCode -ne 0) { Fail "could not set $name" }
  } finally { Remove-Item $tmp -Force -ErrorAction SilentlyContinue }
}

if (-not $values.Contains("FIREBASE_SERVICE_ACCOUNT_BOTRACING_61")) {
  Write-Host "Note: no -ServiceAccountFile, so the release job uses the repo-level FIREBASE_SERVICE_ACCOUNT_BOTRACING_61 to publish." -ForegroundColor Yellow
}

if ($DryRun) { Write-Host "Dry run: nothing was changed."; exit 0 }

# --- what is there now (names only)
Write-Host ""
Write-Host "Environment $EnvName on ${Repo}:"
gh api "repos/$Repo/environments/$EnvName" --jq '"  reviewers: " + ([.protection_rules[] | select(.type=="required_reviewers") | .reviewers[].reviewer.login] | join(", "))'
gh api "repos/$Repo/environments/$EnvName/deployment-branch-policies" --jq '.branch_policies[] | "  deploys from \(.type): \(.name)"'
Write-Host "  secrets set:"
gh secret list --env $EnvName --repo $Repo | ForEach-Object { Write-Host "    $_" }
Write-Host ""
Write-Host "Next: back up ~\.botracing\updater.key and updater.key.password in your password manager."
