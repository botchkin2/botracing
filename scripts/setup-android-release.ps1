# Sets up what the Android release workflow (.github/workflows/android-release.yml)
# runs in. For Botkin to run once, from the repo root:
#
#   .\scripts\setup-android-release.ps1 -DryRun   show what it would do, change nothing
#   .\scripts\setup-android-release.ps1           do it
#
# It makes, and is safe to run again (it fixes the rules and replaces the token):
#   - Environment `android-build`, deployable from android-v* tags only, no
#     reviewer, with the secret EXPO_TOKEN (the EAS build).
#   - Environment `android-release`, deployable from android-v* tags only, with
#     Botkin (the signed-in `gh` user) as the required reviewer (the publish),
#     with EXPO_TOKEN too: the approved job fetches the build from EAS itself.
#   - The repo ruleset `Release tags`: only admins may create, move or delete
#     android-v* and tray-v* tags (a tag starts a build that spends EAS credits).
#   - The android-release account (android/ in the lmu bucket only) and its key
#     in `android-release` as ANDROID_RELEASE_SERVICE_ACCOUNT: `node ops/iam/ciSplit.mjs grant`, which also shows
#     every other CI identity. It needs gcloud signed in as Botkin.
# It prints names and never a secret's value.
#
# Needs: `gh` signed in as the repo owner, `gcloud` signed in as Botkin, node.
# Reads: the Expo token from -ExpoToken or $env:EXPO_TOKEN: a robot token from
#   expo.dev > botventure > Settings > Access tokens (a "robot" user with the
#   Developer role). Leave it out on a later run to keep the one already set.
#
# Not here (by hand, once, docs/ANDROID_BUILD.md "Release"): the signing key
# backup and the release key's SHA-1 on the Google OAuth client.
#Requires -Version 7
param(
  [string]$Repo,
  [string]$ExpoToken = $env:EXPO_TOKEN,
  [switch]$DryRun
)
$ErrorActionPreference = "Stop"
$BuildEnv = "android-build"
$ReleaseEnv = "android-release"
$TagRule = "android-v*"
$RulesetName = "Release tags"
$repoRoot = Split-Path $PSScriptRoot -Parent

function Fail($message) { Write-Host "STOP: $message" -ForegroundColor Red; exit 1 }
function Step($message) { Write-Host $(if ($DryRun) { "[dry run] $message" } else { $message }) }
function Invoke-GhJson($method, $path, $body) {
  $tmp = New-TemporaryFile
  try {
    Set-Content $tmp ($body | ConvertTo-Json -Depth 8)
    gh api -X $method $path --input $tmp *> $null
    return ($LASTEXITCODE -eq 0)
  } finally { Remove-Item $tmp -Force -ErrorAction SilentlyContinue }
}

if (-not (Get-Command gh -ErrorAction SilentlyContinue)) { Fail "gh (GitHub CLI) is not installed" }
gh auth status *> $null
if ($LASTEXITCODE -ne 0) { Fail "gh is not signed in: run gh auth login" }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Fail "node is not installed" }
if (-not (Get-Command gcloud -ErrorAction SilentlyContinue)) { Fail "gcloud is not installed (the release account's grant)" }
if (-not (gcloud config get-value account 2>$null)) { Fail "gcloud is not signed in: run gcloud auth login as yourself" }
if (-not $Repo) { $Repo = (gh repo view --json nameWithOwner --jq .nameWithOwner) }
if (-not $Repo) { Fail "could not tell which repo: pass -Repo owner/name" }

$envs = @(gh api "repos/$Repo/environments" --jq '.environments[].name')
$TokenEnvs = @($BuildEnv, $ReleaseEnv)
$haveToken = @($TokenEnvs | Where-Object {
    ($envs -contains $_) -and (@(gh secret list --env $_ --repo $Repo --json name --jq '.[].name') -contains "EXPO_TOKEN")
  }).Count -eq $TokenEnvs.Count
if (-not $ExpoToken -and -not $haveToken) {
  Write-Host "Missing, nothing was changed:" -ForegroundColor Yellow
  Write-Host "  - the Expo robot token: -ExpoToken, or `$env:EXPO_TOKEN (expo.dev > botventure > Settings > Access tokens)"
  exit 1
}

$userId = gh api user --jq .id
$login = gh api user --jq .login

# --- the two Environments, each deployable from android-v* tags only
function Set-TagOnlyEnvironment($name, [bool]$reviewed) {
  $who = if ($reviewed) { "required reviewer $login" } else { "no reviewer" }
  Step "Environment '$name' on ${Repo}: $who, deployable from tags $TagRule only"
  if ($DryRun) { return }
  $body = @{
    wait_timer = 0
    reviewers = @()
    prevent_self_review = $false   # Botkin is also the one who tags
    deployment_branch_policy = @{protected_branches = $false; custom_branch_policies = $true}
  }
  if ($reviewed) { $body.reviewers = @(@{type = "User"; id = [int]$userId}) }
  if (-not (Invoke-GhJson PUT "repos/$Repo/environments/$name" $body)) { Fail "could not create the Environment $name (does this account own $Repo?)" }
  # Only the tag rule: drop any other policy, add the tag rule if absent.
  $haveTag = $false
  foreach ($line in (gh api "repos/$Repo/environments/$name/deployment-branch-policies" --jq '.branch_policies[] | [.id, .name, .type] | @tsv')) {
    if (-not $line) { continue }
    $id, $pname, $type = $line -split "`t"
    if ($pname -eq $TagRule -and $type -eq "tag") { $haveTag = $true }
    else { gh api -X DELETE "repos/$Repo/environments/$name/deployment-branch-policies/$id" *> $null }
  }
  if (-not $haveTag -and -not (Invoke-GhJson POST "repos/$Repo/environments/$name/deployment-branch-policies" @{name = $TagRule; type = "tag"})) {
    Fail "could not add the $TagRule tag rule to $name"
  }
}
Set-TagOnlyEnvironment $BuildEnv $false
Set-TagOnlyEnvironment $ReleaseEnv $true

# --- EXPO_TOKEN: to gh on stdin from a temporary file, never on a command line
foreach ($name in $TokenEnvs) {
  if (-not $ExpoToken) { Step "secret EXPO_TOKEN in $name : already set, kept"; continue }
  Step "secret EXPO_TOKEN in $name ($($ExpoToken.Length) characters)"
  if ($DryRun) { continue }
  $tmp = New-TemporaryFile
  try {
    [System.IO.File]::WriteAllText($tmp, $ExpoToken)
    $p = Start-Process gh -ArgumentList @("secret", "set", "EXPO_TOKEN", "--env", $name, "--repo", $Repo) `
      -RedirectStandardInput $tmp -NoNewWindow -Wait -PassThru
    if ($p.ExitCode -ne 0) { Fail "could not set EXPO_TOKEN in $name" }
  } finally { Remove-Item $tmp -Force -ErrorAction SilentlyContinue }
}

# --- release tags: only admins create, move or delete them
$ruleset = @{
  name = $RulesetName
  target = "tag"
  enforcement = "active"
  bypass_actors = @(@{actor_id = 5; actor_type = "RepositoryRole"; bypass_mode = "always"})   # 5 = admin
  conditions = @{ref_name = @{include = @("refs/tags/android-v*", "refs/tags/tray-v*"); exclude = @()}}
  rules = @(@{type = "creation"}, @{type = "update"}, @{type = "deletion"})
}
$rulesetId = gh api "repos/$Repo/rulesets" --jq ".[] | select(.name == `"$RulesetName`") | .id"
Step "ruleset '$RulesetName': android-v* and tray-v* tags, admins only ($(if ($rulesetId) { 'update' } else { 'create' }))"
if (-not $DryRun) {
  $ok = if ($rulesetId) { Invoke-GhJson PUT "repos/$Repo/rulesets/$rulesetId" $ruleset }
        else { Invoke-GhJson POST "repos/$Repo/rulesets" $ruleset }
  if (-not $ok) { Fail "could not set the ruleset $RulesetName" }
}

# --- the android-release account and its key (the shared CI identity plan)
Write-Host ""
Step "node ops/iam/ciSplit.mjs grant$(if (-not $DryRun) { ' --apply' })"
$grant = [System.Collections.Generic.List[string]]@("$repoRoot/ops/iam/ciSplit.mjs", "grant")
if (-not $DryRun) { $grant.Add("--apply") }
node @grant
if ($LASTEXITCODE -ne 0) { Fail "ciSplit grant failed (above)" }
if ($DryRun) {
  if ($envs -notcontains $ReleaseEnv) { Write-Host "(The key step for $ReleaseEnv shows once the Environment exists, on the real run.)" }
  Write-Host "Dry run: nothing was changed."
  exit 0
}

# --- what is there now (names only)
Write-Host ""
foreach ($name in @($BuildEnv, $ReleaseEnv)) {
  Write-Host "Environment $name on ${Repo}:"
  gh api "repos/$Repo/environments/$name" --jq '"  reviewers: " + ([.protection_rules[]? | select(.type=="required_reviewers") | .reviewers[].reviewer.login] | join(", ") | if . == "" then "-" else . end)'
  gh api "repos/$Repo/environments/$name/deployment-branch-policies" --jq '.branch_policies[] | "  deploys from \(.type): \(.name)"'
  Write-Host "  secrets: $((@(gh secret list --env $name --repo $Repo --json name --jq '.[].name')) -join ', ')"
}
gh api "repos/$Repo/rulesets" --jq ".[] | select(.name == `"$RulesetName`") | `"Ruleset \(.name): \(.enforcement)`""
