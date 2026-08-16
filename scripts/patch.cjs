/**
 * Incremental patch: copy the current src/*.cjs over the installed app's
 * unpacked code (resources/app.asar.unpacked/src/), then the running app picks
 * up the changes on restart — no framework re-download, no installer rebuild.
 *
 * Usage: npm run patch   (requires a one-time install of a build with
 *                         asarUnpack enabled; older installs have no unpacked src)
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const srcDir = path.join(__dirname, '..', 'src');

/**
 * Locate the installed app directory. Since 0.1.7 the installer lets the user
 * pick an install path, so do not assume the default location — first try the
 * default, then read InstallLocation from the registry (per-user install info
 * is stored at HKCU\Software\<app-guid>\InstallLocation; the GUID is found by
 * scanning the Uninstall keys for the app's DisplayName).
 */
function findInstallDir() {
  // electron-builder uses different default folder names per installer mode:
  // oneClick → "deepseek-harness-desktop", assisted → "DeepSeek Harness".
  const defaults = [
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'deepseek-harness-desktop'),
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'DeepSeek Harness'),
  ];
  for (const d of defaults) if (fs.existsSync(path.join(d, 'DeepSeek Harness.exe'))) return d;
  try {
    const ps = `
      $ErrorActionPreference = 'SilentlyContinue'
      foreach ($hive in @('HKCU:', 'HKLM:')) {
        Get-ChildItem "$hive\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall" | ForEach-Object {
          if ($_.GetValue('DisplayName') -like 'DeepSeek Harness*') {
            $loc = (Get-ItemProperty "HKCU:\\Software\\$($_.PSChildName)").InstallLocation
            if ($loc -and (Test-Path (Join-Path $loc 'DeepSeek Harness.exe'))) { Write-Output $loc; exit 0 }
          }
        }
      }
    `;
    const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 20000,
    });
    const dir = out.trim().split(/\r?\n/)[0];
    if (dir && fs.existsSync(path.join(dir, 'DeepSeek Harness.exe'))) return dir;
  } catch {
    /* fall through */
  }
  return null;
}

const installDir = findInstallDir();

if (!installDir) {
  console.error('[patch] 未找到已安装的 DeepSeek Harness（默认目录或注册表均未命中）。');
  console.error('[patch] 请先安装应用，再使用 patch 增量更新。');
  process.exit(1);
}

const unpackedSrc = path.join(installDir, 'resources', 'app.asar.unpacked', 'src');

if (!fs.existsSync(unpackedSrc)) {
  console.error(`[patch] 未找到已安装的代码目录：${unpackedSrc}`);
  console.error('[patch] 请先安装带增量支持（asarUnpack）的新版安装包，再使用 patch。');
  process.exit(1);
}

const files = fs.readdirSync(srcDir).filter((f) => {
  try {
    return fs.statSync(path.join(srcDir, f)).isFile();
  } catch {
    return false;
  }
});
if (files.length === 0) {
  console.error('[patch] src/ 下没有文件可复制。');
  process.exit(1);
}

// The app loads code from app.asar, whose directory tree is fixed at build
// time. Copying a brand-new src file into app.asar.unpacked/src does NOT make
// it loadable — require()/loadFile() would fail with "Cannot find module".
// Detect new files up front and refuse instead of breaking the installed app.
try {
  const asar = require('@electron/asar');
  const asarPath = path.join(installDir, 'resources', 'app.asar');
  if (fs.existsSync(asarPath)) {
    const asarFiles = new Set(
      asar.listPackage(asarPath).map((p) => p.replace(/^[/\\]+/, '').toLowerCase()),
    );
    const newFiles = files.filter((f) => !asarFiles.has(path.join('src', f).toLowerCase()));
    if (newFiles.length > 0) {
      console.error('[patch] 检测到新增文件，补丁无法让应用加载它们：');
      for (const f of newFiles) console.error(`  - ${f}`);
      console.error('[patch] 原因：应用从 app.asar 加载代码，asar 目录树在打包时固定，');
      console.error('        补丁只能覆盖已存在的文件，新增文件无法被 require/loadFile 找到。');
      console.error('[patch] 请改用完整安装包（npm run dist 后重新安装），而不是 patch。');
      process.exit(1);
    }
  }
} catch (error) {
  if (error && error.code === 'MODULE_NOT_FOUND') {
    console.warn('[patch] 警告：未找到 @electron/asar，跳过新增文件检测（请先 npm install）。');
  } else {
    throw error;
  }
}

console.log(`[patch] 已定位安装目录：${installDir}`);
for (const file of files) {
  fs.copyFileSync(path.join(srcDir, file), path.join(unpackedSrc, file));
  console.log(`[patch] 已覆盖 ${file}`);
}

console.log(`[patch] 完成：${files.length} 个代码文件已更新。重启应用即生效（框架无需重新下载）。`);
