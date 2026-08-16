# DeepSeek Harness 增量补丁应用脚本 / Incremental patch installer
# 将本 zip 内的 src/ 文件复制到已安装应用的解包代码目录，重启后生效。
# 用法：解压 zip 后，双击 apply-patch.cmd；或右键本文件 → "使用 PowerShell 运行"。
param(
  [string]$InstallDir = "",
  [switch]$SkipVersionCheck
)

$ErrorActionPreference = 'Stop'

# 定位已安装应用：默认目录 → 注册表（0.1.7+ 安装器支持自定义安装路径）
# electron-builder 不同模式默认目录名不同：oneClick → deepseek-harness-desktop，assisted → DeepSeek Harness
function Find-InstallDir {
  $defaults = @(
    (Join-Path $env:LOCALAPPDATA 'Programs\deepseek-harness-desktop'),
    (Join-Path $env:LOCALAPPDATA 'Programs\DeepSeek Harness')
  )
  foreach ($d in $defaults) {
    if (Test-Path (Join-Path $d 'DeepSeek Harness.exe')) { return $d }
  }
  $hives = @(
    'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
    'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
    'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall'
  )
  foreach ($hive in $hives) {
    Get-ChildItem $hive -ErrorAction SilentlyContinue | ForEach-Object {
      if ($_.GetValue('DisplayName') -like 'DeepSeek Harness*') {
        $loc = (Get-ItemProperty "HKCU:\Software\$($_.PSChildName)" -ErrorAction SilentlyContinue).InstallLocation
        if ($loc -and (Test-Path (Join-Path $loc 'DeepSeek Harness.exe'))) { return $loc }
      }
    }
  }
  return $null
}

if (-not $InstallDir) { $InstallDir = Find-InstallDir }
if (-not $InstallDir) {
  Write-Host "未找到已安装的 DeepSeek Harness（默认目录或注册表均未命中）。请先安装完整版再应用补丁。"
  exit 1
}

$exe = Join-Path $InstallDir 'DeepSeek Harness.exe'
$target = Join-Path $InstallDir 'resources\app.asar.unpacked\src'
$metaPath = Join-Path $PSScriptRoot 'patch.json'

if (-not (Test-Path $exe)) {
  Write-Host "未找到已安装的应用（$InstallDir）。请先安装完整版再应用补丁。"
  exit 1
}
if (-not (Test-Path $metaPath)) {
  Write-Host "缺少 patch.json（请解压完整补丁包）。"
  exit 1
}

$meta = Get-Content $metaPath -Raw | ConvertFrom-Json
$installedVersion = (Get-Item $exe).VersionInfo.FileVersion

if (-not $SkipVersionCheck -and $installedVersion -ne $meta.from) {
  Write-Host "版本不匹配：本机已安装 v$installedVersion，此补丁要求从 v$($meta.from) 升级。"
  Write-Host "请先安装 v$($meta.from) 的完整安装包，再应用此补丁。"
  exit 1
}
if (-not (Test-Path $target)) {
  Write-Host "未找到代码目录（$target）。请先安装带增量支持（asarUnpack）的新版安装包。"
  exit 1
}

Copy-Item -Path (Join-Path $PSScriptRoot 'src\*') -Destination $target -Recurse -Force
Write-Host "补丁 v$($meta.from) → v$($meta.to) 已应用（$($meta.files.Count) 个文件）。"
Write-Host "安装目录：$InstallDir"
Write-Host "请退出并重新启动 DeepSeek Harness 生效。"
