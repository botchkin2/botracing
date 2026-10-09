# Builds the tray app with the sign-in configuration embedded. The tray signs in
# through the web app, so the only thing it needs is the Firebase web API key
# (Firebase console, Project settings, General: "Web API Key"; it names the
# project and is public, but it stays out of git). It comes from -FirebaseApiKey
# or the BOTRACING_FIREBASE_API_KEY variable, else the public one in
# src\auth\firebase.web.ts.
#
#   .\scripts\build.ps1                      debug build (cargo build)
#   .\scripts\build.ps1 -Release             installer (tauri build)
#   .\scripts\build.ps1 -Test                cargo test
param(
  [string]$FirebaseApiKey = $env:BOTRACING_FIREBASE_API_KEY,
  [switch]$Release,
  [switch]$Test
)
$ErrorActionPreference = "Stop"
$env:Path += ";$env:USERPROFILE\.cargo\bin"

$desktop = Split-Path $PSScriptRoot -Parent
if (-not $FirebaseApiKey) {
  $webConfig = Join-Path (Split-Path $desktop -Parent) "src\auth\firebase.web.ts"
  $m = [regex]::Match((Get-Content $webConfig -Raw), "apiKey:\s*'([^']+)'")
  if ($m.Success) { $FirebaseApiKey = $m.Groups[1].Value }
}
if (-not $FirebaseApiKey) {
  throw "Give -FirebaseApiKey or set BOTRACING_FIREBASE_API_KEY (Firebase console, Project settings, Web API Key)"
}
$env:BOTRACING_FIREBASE_API_KEY = $FirebaseApiKey

if ($Release) {
  Set-Location $desktop
  npx tauri build
} else {
  Set-Location (Join-Path $desktop "src-tauri")
  if ($Test) { cargo test } else { cargo build }
}
