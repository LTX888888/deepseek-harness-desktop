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

const release = path.join(__dirname, '..', 'release');
const version = require(path.join(__dirname, '..', 'package.json')).version;

const KEEP = new Set([
  `DeepSeek-Harness-Setup-${version}.exe`,
  `DeepSeek-Harness-Portable-${version}.exe`,
  `DeepSeek-Harness-Uninstall-${version}.exe`,
]);

function installedUninstaller() {
  const p = path.join(
    process.env.LOCALAPPDATA || '',
    'Programs',
    'deepseek-harness-desktop',
    'Uninstall DeepSeek Harness.exe',
  );
  return fs.existsSync(p) ? p : null;
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
