# ดาวน์โหลด yt-dlp + ffmpeg + ffprobe มาไว้ที่ src-tauri/bin ก่อน build
# ใช้: powershell -ExecutionPolicy Bypass -File scripts/fetch-binaries.ps1 [-Force] [-Arch x64|arm64]
param([switch]$Force, [ValidateSet("x64", "arm64")][string]$Arch = "x64")
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$bin = Join-Path $PSScriptRoot "..\src-tauri\bin"
New-Item -ItemType Directory -Force $bin | Out-Null
$tmp = Join-Path ([IO.Path]::GetTempPath()) "mtb-bin-$(Get-Random)"
New-Item -ItemType Directory -Force $tmp | Out-Null

# yt-dlp (รุ่นล่าสุดจาก GitHub ทางการ)
$yt = Join-Path $bin "yt-dlp.exe"
if ($Force -or -not (Test-Path $yt)) {
  $name = if ($Arch -eq "arm64") { "yt-dlp_arm64.exe" } else { "yt-dlp.exe" }
  Write-Host "⬇️  กำลังโหลด yt-dlp ($name)..."
  Invoke-WebRequest "https://github.com/yt-dlp/yt-dlp/releases/latest/download/$name" -OutFile $yt
} else { Write-Host "✅ มี yt-dlp แล้ว" }

# ffmpeg + ffprobe (BtbN GPL build — มี libx264/x265/svt-av1/nvenc/qsv/amf)
$ff = Join-Path $bin "ffmpeg.exe"
if ($Force -or -not (Test-Path $ff)) {
  $pkg = if ($Arch -eq "arm64") { "ffmpeg-master-latest-winarm64-gpl" } else { "ffmpeg-master-latest-win64-gpl" }
  Write-Host "⬇️  กำลังโหลด ffmpeg ($pkg)..."
  $zip = Join-Path $tmp "ffmpeg.zip"
  Invoke-WebRequest "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/$pkg.zip" -OutFile $zip
  Expand-Archive $zip -DestinationPath $tmp -Force
  foreach ($exe in "ffmpeg.exe", "ffprobe.exe") {
    Copy-Item (Get-ChildItem $tmp -Recurse -Filter $exe | Select-Object -First 1).FullName (Join-Path $bin $exe) -Force
  }
} else { Write-Host "✅ มี ffmpeg แล้ว" }

Remove-Item $tmp -Recurse -Force
Get-ChildItem $bin -Filter *.exe | ForEach-Object { "{0,-14} {1,8:N1} MB" -f $_.Name, ($_.Length / 1MB) }
