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
#   the Firebase web key: -FirebaseApiKey, or the public one in src\auth\firebase.web.ts
#   -ServiceAccountFile (optional)                   a service account key JSON that may write
#                                                    to the botracing-61-lmu bucket. Without it
#                                                    the release job falls back to the repo-level
#                                                    FIREBASE_SERVICE_ACCOUNT_BOTRACING_61.
#
# The updater key and password also go to Secret Manager (project botracing-61,
# secrets tray-updater-key and tray-updater-password), readable by the signed-in
# gcloud account only: the secrets get their own secret-level binding and nothing
# at project level (thread 54 #2610: no runtime or CI identity reads them). Once
# both copies are read back and match, ~\.botracing\updater.key and .password are
# deleted. Lose the key and installed trays can no longer update; this is its
# backup. A later run with the files gone reads the key from Secret Manager.
#
# Also needs: `gcloud` signed in as Botkin (gcloud auth list) and the Secret Manager
# API enabled on the project.
#Requires -Version 7
param(
  [string]$Repo,
  [string]$FirebaseApiKey = $env:BOTRACING_FIREBASE_API_KEY,
  [string]$ServiceAccountFile,
  [string]$GcpProject = "botracing-61",
  [switch]$DryRun
)
$ErrorActionPreference = "Stop"
$EnvName = "tray-release"
$KeySecret = "tray-updater-key"
$PasswordSecret = "tray-updater-password"
$botracing = Join-Path $env:USERPROFILE ".botracing"
$repoRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent

function Fail($message) { Write-Host "STOP: $message" -ForegroundColor Red; exit 1 }
function Read-LatestSecret($name) {
  $v = gcloud secrets versions access latest --secret $name --project $GcpProject 2>$null
  if ($LASTEXITCODE -ne 0 -or -not $v) { return $null }
  return ($v -join "`n").Trim()
}
# The value goes to gcloud on stdin, exactly, with no trailing newline (a pipe from
# PowerShell would add one) and no plain-text copy of the key in %TEMP%.
function Add-SecretVersion($name, $value) {
  $psi = [System.Diagnostics.ProcessStartInfo]::new((Get-Command gcloud.cmd).Source)
  foreach ($arg in @("secrets", "versions", "add", $name, "--project", $GcpProject, "--data-file=-")) { $psi.ArgumentList.Add($arg) }
  $psi.RedirectStandardInput = $true
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.UseShellExecute = $false
  $proc = [System.Diagnostics.Process]::Start($psi)
  $proc.StandardInput.Write($value)
  $proc.StandardInput.Close()
  [void]$proc.StandardOutput.ReadToEnd()
  [void]$proc.StandardError.ReadToEnd()
  $proc.WaitForExit()
  return ($proc.ExitCode -eq 0)
}
function Step($message) { Write-Host $(if ($DryRun) { "[dry run] $message" } else { $message }) }

if (-not (Get-Command gh -ErrorAction SilentlyContinue)) { Fail "gh (GitHub CLI) is not installed" }
gh auth status *> $null
if ($LASTEXITCODE -ne 0) { Fail "gh is not signed in: run gh auth login" }
if (-not $Repo) { $Repo = (gh repo view --json nameWithOwner --jq .nameWithOwner) }
if (-not $Repo) { Fail "could not tell which repo: pass -Repo owner/name" }
if (-not (Get-Command gcloud -ErrorAction SilentlyContinue)) { Fail "gcloud is not installed (the updater key backup goes to Secret Manager)" }
$gcloudUser = (gcloud config get-value account 2>$null)
if (-not $gcloudUser) { Fail "gcloud is not signed in: run gcloud auth login as yourself" }

# --- the values, read now so a missing file stops the script before it changes anything
$values = [ordered]@{}
$missing = @()

$keyFile = Join-Path $botracing "updater.key"
$pwFile = Join-Path $botracing "updater.key.password"
$haveFiles = (Test-Path $keyFile) -and (Test-Path $pwFile)
if ($haveFiles) {
  $values["TAURI_SIGNING_PRIVATE_KEY"] = (Get-Content $keyFile -Raw).Trim()
  $values["TAURI_SIGNING_PRIVATE_KEY_PASSWORD"] = (Get-Content $pwFile -Raw).Trim()
} else {
  # Files already moved to Secret Manager by an earlier run: read them back from there.
  $fromKey = Read-LatestSecret $KeySecret
  $fromPw = Read-LatestSecret $PasswordSecret
  if ($fromKey -and $fromPw) {
    $values["TAURI_SIGNING_PRIVATE_KEY"] = $fromKey
    $values["TAURI_SIGNING_PRIVATE_KEY_PASSWORD"] = $fromPw
  } else {
    $missing += "the updater key ($keyFile and $pwFile, or Secret Manager $KeySecret and $PasswordSecret)"
  }
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

# --- the updater key's second copy: Secret Manager, readable by $gcloudUser only
$copies = [ordered]@{
  $KeySecret = "TAURI_SIGNING_PRIVATE_KEY"
  $PasswordSecret = "TAURI_SIGNING_PRIVATE_KEY_PASSWORD"
}
foreach ($secret in $copies.Keys) {
  Step "Secret Manager $GcpProject/${secret}: new version if the value differs; $gcloudUser the only reader (secret-level)"
}
if ($haveFiles) { Step "after both copies read back equal: delete $keyFile and $pwFile" }
if ($DryRun) { Write-Host "Dry run: nothing was changed."; exit 0 }

$verified = $true
foreach ($secret in $copies.Keys) {
  $value = $values[$copies[$secret]]
  gcloud secrets describe $secret --project $GcpProject *> $null
  if ($LASTEXITCODE -ne 0) {
    gcloud secrets create $secret --project $GcpProject --replication-policy automatic --quiet *> $null
    if ($LASTEXITCODE -ne 0) { Fail "could not create secret $secret (is the Secret Manager API enabled?)" }
  }
  if ((Read-LatestSecret $secret) -ne $value) {
    if (-not (Add-SecretVersion $secret $value)) { Fail "could not add a version to $secret" }
  }
  # Secret-level binding for this user only; no project-level role is granted.
  gcloud secrets add-iam-policy-binding $secret --project $GcpProject `
    --member "user:$gcloudUser" --role roles/secretmanager.admin --quiet *> $null
  if ($LASTEXITCODE -ne 0) { Fail "could not grant $gcloudUser on $secret" }
  if ((Read-LatestSecret $secret) -eq $value) { Write-Host "  Secret Manager $secret : read back, matches" }
  else { Write-Host "  Secret Manager $secret : DOES NOT MATCH, local files kept" -ForegroundColor Red; $verified = $false }
}
if ($haveFiles) {
  if ($verified) {
    Remove-Item $keyFile, $pwFile -Force
    Write-Host "  deleted $keyFile and $pwFile (their copy is in Secret Manager)"
  } else { Fail "Secret Manager copy did not verify; $keyFile and $pwFile were kept" }
}

# --- what is there now (names only)
Write-Host ""
Write-Host "Environment $EnvName on ${Repo}:"
gh api "repos/$Repo/environments/$EnvName" --jq '"  reviewers: " + ([.protection_rules[] | select(.type=="required_reviewers") | .reviewers[].reviewer.login] | join(", "))'
gh api "repos/$Repo/environments/$EnvName/deployment-branch-policies" --jq '.branch_policies[] | "  deploys from \(.type): \(.name)"'
Write-Host "  secrets set:"
gh secret list --env $EnvName --repo $Repo | ForEach-Object { Write-Host "    $_" }
Write-Host ""
Write-Host "The updater key lives in Secret Manager ($KeySecret, $PasswordSecret) and the GitHub Environment. A local release build reads it: gcloud secrets versions access latest --secret $KeySecret --project $GcpProject"
