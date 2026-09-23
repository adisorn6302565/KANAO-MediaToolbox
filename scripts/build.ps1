# สคริปต์ build ตัวติดตั้ง Windows ครบขั้นตอน
# ใช้: powershell -ExecutionPolicy Bypass -File scripts/build.ps1 [-SkipFetch] [-SkipTests] [-Target x86_64-pc-windows-msvc|aarch64-pc-windows-msvc]
param([switch]$SkipFetch, [switch]$SkipTests, [string]$Target = "x86_64-pc-windows-msvc")
$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")
function Step($t) { Write-Host "`n━━━ $t ━━━" -ForegroundColor Cyan }
function Check { if ($LASTEXITCODE -ne 0) { throw "ล้มเหลว (exit $LASTEXITCODE)" } }

Step "1/4 ติดตั้งแพ็กเกจ"
npm ci; Check

if (-not $SkipFetch) {
  Step "2/4 เตรียม yt-dlp / ffmpeg"
  $arch = if ($Target -like "aarch64*") { "arm64" } else { "x64" }
  & (Join-Path $PSScriptRoot "fetch-binaries.ps1") -Arch $arch
}

if (-not $SkipTests) {
  Step "3/4 ทดสอบ"
  npm run typecheck; Check
  npm test; Check
  Push-Location src-tauri; cargo test --release; Check; Pop-Location
}

Step "4/4 Build ตัวติดตั้ง"
npx tauri build --target $Target; Check
$out = "src-tauri/target/$Target/release/bundle"
Get-ChildItem $out -Recurse -Include *.exe, *.msi | ForEach-Object { "📦 {0}  ({1:N1} MB)" -f $_.FullName, ($_.Length / 1MB) }
