# Create a GitHub Release for the current version and upload its installers.
# Reads the version from package.json and the GitHub token from the git
# credential helper (never prints it).
# Usage: powershell -ExecutionPolicy Bypass -File scripts/release-github.ps1
$ErrorActionPreference = 'Stop'

$root = Split-Path $PSScriptRoot -Parent
$pkg = Get-Content (Join-Path $root 'package.json') -Raw | ConvertFrom-Json
$version = $pkg.version
$repo = 'LTX888888/deepseek-harness-desktop'
$tag = "v$version"
$relDir = Join-Path $root 'release'

# --- resolve token from git credential helper ---
$cred = "protocol=https`nhost=github.com`n`n" | git credential fill 2>$null
$token = ($cred -split "`n" | Where-Object { $_ -match '^password=' } | Select-Object -First 1) -replace '^password=', ''
if (-not $token) { Write-Output 'FAIL: no GitHub token available'; exit 1 }

$headers = @{
  Authorization = "Bearer $token"
  'User-Agent' = 'dsh-desktop-release'
  Accept = 'application/vnd.github+json'
}

$notes = @"
# v$version

DeepSeek Harness 桌面端安装包。完整更新日志见仓库提交历史与 [README](https://github.com/$repo#readme)。

## 下载 / Downloads
- `DeepSeek-Harness-Setup-$version.exe` — 安装版（推荐，向导式可选安装目录）
- `DeepSeek-Harness-Portable-$version.exe` — 免安装便携版
"@

# --- find or create the release ---
$release = $null
try {
  $release = Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/releases/tags/$tag" -Headers $headers -ErrorAction Stop
  Write-Output "release already exists: id=$($release.id)"
} catch {
  if ($_.Exception.Response.StatusCode.value__ -eq 404) {
    $body = @{ tag_name = $tag; target_commitish = 'master'; name = "v$version"; body = $notes; draft = $false; prerelease = $false } | ConvertTo-Json
    $release = Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/releases" -Method Post -Headers $headers -Body $body -ContentType 'application/json'
    Write-Output "created release: id=$($release.id)"
  } else {
    Write-Output "FAIL checking release: $($_.Exception.Message)"
    exit 1
  }
}

$uploadUrl = $release.upload_url

function Upload-Asset {
  param([string]$File, [string]$Name)
  $u = $uploadUrl -replace '\{\?name,label\}', "?name=$Name"
  try {
    $asset = Invoke-RestMethod -Uri $u -Method Post -Headers $headers -InFile $File -ContentType 'application/octet-stream'
    Write-Output "  OK  $Name  ->  $($asset.browser_download_url)"
  } catch {
    Write-Output "  FAIL  $Name  ->  $($_.Exception.Message)"
  }
}

Upload-Asset (Join-Path $relDir "DeepSeek-Harness-Setup-$version.exe") "DeepSeek-Harness-Setup-$version.exe"
Upload-Asset (Join-Path $relDir "DeepSeek-Harness-Portable-$version.exe") "DeepSeek-Harness-Portable-$version.exe"

Write-Output "DONE: https://github.com/$repo/releases/tag/$tag"
