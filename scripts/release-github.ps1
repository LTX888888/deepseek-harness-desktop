# Create GitHub Release v0.1.8 and upload installers.
# Reads the GitHub token from the credential helper (never prints it).
$ErrorActionPreference = 'Stop'

$repo = 'LTX888888/deepseek-harness-desktop'
$tag = 'v0.1.8'
$relDir = Join-Path (Split-Path $PSScriptRoot -Parent) 'release'

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
# v0.1.8

## 新增 / New
- **全屏**：菜单「视图 → 全屏」动态标签，全屏时右上角「退出全屏」悬浮按钮（支持 F11）
- **安装器**：向导式安装，可选安装目录（按用户安装、免管理员），开始菜单含「卸载」快捷方式
- **增量补丁**：`make-patch` 基线工具 + 注册表定位 + 新增文件防护

## 此前已含 / Included
- **皮肤管理**：菜单「皮肤」切换、`~/.dsh/skins`、从 GitHub 一键安装（含安装后立即切换确认）
- **安全**：`DSH_TELEMETRY_DISABLED=1`，无遥测、不读凭据、仅本机监听

## 下载 / Downloads
- `DeepSeek-Harness-Setup-0.1.8.exe` — 安装版（推荐）
- `DeepSeek-Harness-Portable-0.1.8.exe` — 免安装便携版
"@

# --- find or create the release ---
$release = $null
try {
  $release = Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/releases/tags/$tag" -Headers $headers -ErrorAction Stop
  Write-Output "release already exists: id=$($release.id)"
} catch {
  if ($_.Exception.Response.StatusCode.value__ -eq 404) {
    $body = @{ tag_name = $tag; target_commitish = 'master'; name = 'v0.1.8'; body = $notes; draft = $false; prerelease = $false } | ConvertTo-Json
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

Upload-Asset (Join-Path $relDir 'DeepSeek-Harness-Setup-0.1.8.exe') 'DeepSeek-Harness-Setup-0.1.8.exe'
Upload-Asset (Join-Path $relDir 'DeepSeek-Harness-Portable-0.1.8.exe') 'DeepSeek-Harness-Portable-0.1.8.exe'

Write-Output "DONE: https://github.com/$repo/releases/tag/$tag"
