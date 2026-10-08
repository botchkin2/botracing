# Builds the tray app with the sign-in configuration embedded. The OAuth client
# and the Firebase web key are not in git: this reads them from your machine.
#
#   .\scripts\build.ps1                      debug build (cargo build)
#   .\scripts\build.ps1 -Release             installer (tauri build)
#   .\scripts\build.ps1 -Test                cargo test
#
# The client file is the JSON Google lets you download for a desktop client
# ({"installed": {"client_id": ..., "client_secret": ...}}), by default
# ~\.botracing\oauth-desktop.json. The Firebase web API key (Firebase console,
# Project settings, General: "Web API Key") comes from -FirebaseApiKey or the
# BOTRACING_FIREBASE_API_KEY variable. An installed desktop app's client secret
# is not secret (Google says so; PKCE is the protection), but it stays out of
# git and out of chat.
param(
  [string]$ClientFile = (Join-Path $env:USERPROFILE ".botracing\oauth-desktop.json"),
  [string]$FirebaseApiKey = $env:BOTRACING_FIREBASE_API_KEY,
  [switch]$Release,
  [switch]$Test
)
$ErrorActionPreference = "Stop"
$env:Path += ";$env:USERPROFILE\.cargo\bin"

$json = Get-Content $ClientFile -Raw | ConvertFrom-Json
$client = if ($json.installed) { $json.installed } else { $json }
if (-not $client.client_id -or -not $client.client_secret) {
  throw "$ClientFile has no client_id and client_secret"
}
if (-not $FirebaseApiKey) {
  throw "Give -FirebaseApiKey or set BOTRACING_FIREBASE_API_KEY (Firebase console, Project settings, Web API Key)"
}
$env:BOTRACING_OAUTH_CLIENT_ID = $client.client_id
$env:BOTRACING_OAUTH_CLIENT_SECRET = $client.client_secret
$env:BOTRACING_FIREBASE_API_KEY = $FirebaseApiKey

$desktop = Split-Path $PSScriptRoot -Parent
if ($Release) {
  Set-Location $desktop
  npx tauri build
} else {
  Set-Location (Join-Path $desktop "src-tauri")
  if ($Test) { cargo test } else { cargo build }
}
