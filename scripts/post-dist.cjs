/**
 * Post-build step: leave release/ with exactly the current version's three
 * artifacts (installer, portable, uninstaller) and nothing else.
 *
 * 1. Refresh the standalone uninstaller (installed copy, then carried-forward
 *    existing copy, then warn).
 * 2. Remove every other file/dir electron-builder left behind: previous
 *    version artifacts, blockmaps, win-unpacked, builder-debug.yml, .icon-ico.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const release = path.join(__dirname, '..', 'release');
const version = require(path.join(__dirname, '..', 'package.json')).version;

const KEEP = new Set([
  `DeepSeek-Harness-Setup-${version}.exe`,
  `DeepSeek-Harness-Portable-${version}.exe`,
  `DeepSeek-Harness-Uninstall-${version}.exe`,
]);

/** Locate the installed app's uninstaller (default path → registry, for custom install dirs). */
function installedUninstaller() {
  const defaults = [
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'deepseek-harness-desktop', 'Uninstall DeepSeek Harness.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'DeepSeek Harness', 'Uninstall DeepSeek Harness.exe'),
  ];
  for (const p of defaults) if (fs.existsSync(p)) return p;
  try {
    const ps = `
      $ErrorActionPreference = 'SilentlyContinue'
      foreach ($hive in @('HKCU:', 'HKLM:')) {
        Get-ChildItem "$hive\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall" | ForEach-Object {
          if ($_.GetValue('DisplayName') -like 'DeepSeek Harness*') {
            $loc = (Get-ItemProperty "HKCU:\\Software\\$($_.PSChildName)").InstallLocation
            if ($loc -and (Test-Path (Join-Path $loc 'Uninstall DeepSeek Harness.exe'))) { Write-Output (Join-Path $loc 'Uninstall DeepSeek Harness.exe'); exit 0 }
          }
        }
      }
    `;
    const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 20000,
    });
    const p = out.trim().split(/\r?\n/)[0];
    if (p && fs.existsSync(p)) return p;
  } catch {
    /* fall through */
  }
  return null;
}

function existingUninstaller() {
  let files;
  try {
    files = fs.readdirSync(release).filter((f) => /^DeepSeek-Harness-Uninstall-.*\.exe$/.test(f));
  } catch {
    return null;
  }
  if (files.length === 0) return null;
  files.sort();
  return path.join(release, files[files.length - 1]);
}

try {
  // 1. Ensure the uninstaller for the current version exists.
  const target = path.join(release, `DeepSeek-Harness-Uninstall-${version}.exe`);
  const src = installedUninstaller() || existingUninstaller();
  if (src) {
    if (src !== target) fs.copyFileSync(src, target);
    console.log(`[post-dist] Uninstaller ready: DeepSeek-Harness-Uninstall-${version}.exe`);
  } else {
    console.log('[post-dist] WARNING: no uninstaller source — install the app once to produce one.');
  }

  // 2. Prune everything except the current version's three artifacts.
  let removed = 0;
  for (const entry of fs.readdirSync(release, { withFileTypes: true })) {
    if (KEEP.has(entry.name)) continue;
    fs.rmSync(path.join(release, entry.name), { recursive: true, force: true });
    removed += 1;
  }
  if (removed > 0) console.log(`[post-dist] Pruned ${removed} stale entr${removed === 1 ? 'y' : 'ies'} from release/.`);
} catch (error) {
  console.error('[post-dist] Failed:', error);
}
