/**
 * Incremental patch publisher for already-installed apps.
 *
 * The full installer is ~123 MB, but 99% of it (Electron + bundled harness
 * runtime) never changes between versions — only the small src/ files do.
 * Users who already have any asarUnpack build installed can update by
 * applying a few-KB patch zip instead of re-downloading the installer.
 *
 * Flow:
 *   1. First run after a release: snapshots src/ file hashes into
 *      patches/src-manifest.json — baseline only, no patch (nothing to diff).
 *   2. After the next code change: run again → diffs src/ against the
 *      baseline → writes patches/patch-<from>-to-<to>.zip containing ONLY the
 *      changed/new files (as src/...) + patch.json + apply-patch.ps1, then
 *      rolls the baseline forward to the current state.
 *
 * Env overrides (for testing): PATCH_SRC, PATCH_MANIFEST, PATCH_OUT,
 *                              PATCH_VERSION
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const srcDir = process.env.PATCH_SRC || path.join(root, 'src');
const manifestPath = process.env.PATCH_MANIFEST || path.join(root, 'patches', 'src-manifest.json');
const outDir = process.env.PATCH_OUT || path.join(root, 'patches');
const version = process.env.PATCH_VERSION || require(path.join(root, 'package.json')).version;
const templatePath = path.join(__dirname, 'apply-patch.template.ps1');

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function snapshot() {
  const map = {};
  for (const name of fs.readdirSync(srcDir).sort()) {
    const full = path.join(srcDir, name);
    let stat;
    try {
      stat = fs.statSync(full);
    } catch {
      continue;
    }
    if (stat.isFile()) map[name] = sha256(full);
  }
  return map;
}

let baseline = { version: null, files: {} };
if (fs.existsSync(manifestPath)) {
  try {
    baseline = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (!baseline.files) baseline.files = {};
  } catch {
    baseline = { version: null, files: {} };
  }
}

const current = snapshot();
// Distinguish added/removed from merely-changed: the app loads code from
// app.asar, whose directory tree is fixed at build time, so a patch can only
// OVERWRITE existing files — it can never make the app load a brand-new file.
const added = Object.keys(current).filter((f) => !(f in baseline.files));
const removed = Object.keys(baseline.files).filter((f) => !(f in current));
const changed = Object.keys(current).filter((f) => f in baseline.files && baseline.files[f] !== current[f]);

const writeManifest = () => {
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, JSON.stringify({ version, files: current }, null, 2));
};

if (baseline.version == null) {
  writeManifest();
  console.log(
    `[make-patch] 基线已建立（v${version}，${Object.keys(current).length} 个文件）。` +
    '下次改动 src/ 后再运行，即可生成增量补丁 zip。'
  );
  process.exit(0);
}

// New or deleted files cannot be delivered as a patch (the app's asar tree is
// fixed). Roll the baseline forward and tell the publisher to ship the full
// installer for this version instead.
if (added.length > 0 || removed.length > 0) {
  writeManifest();
  console.log('[make-patch] 本次包含新增/删除文件，无法生成补丁，基线已更新到 v' + version + '。');
  if (added.length > 0) console.log(`[make-patch]   新增：${added.join(', ')}`);
  if (removed.length > 0) console.log(`[make-patch]   删除：${removed.join(', ')}`);
  console.log('[make-patch] 原因：应用从 app.asar 加载代码，asar 目录树在打包时固定，');
  console.log('[make-patch]        补丁只能覆盖已存在的文件，无法让应用加载新文件。');
  console.log('[make-patch] 请用完整安装包发布此版本（npm run release 已生成安装包）。');
  process.exit(0);
}

if (changed.length === 0) {
  writeManifest();
  console.log('[make-patch] src/ 无变化，未生成补丁。');
  process.exit(0);
}

// Stage the patch payload: changed files as src/, metadata, apply script.
const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-patch-'));
try {
  const stageSrc = path.join(stage, 'src');
  fs.mkdirSync(stageSrc, { recursive: true });
  for (const f of changed) fs.copyFileSync(path.join(srcDir, f), path.join(stageSrc, f));

  const meta = {
    from: baseline.version,
    to: version,
    files: changed,
    createdAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(stage, 'patch.json'), JSON.stringify(meta, null, 2));
  // PowerShell 5.1 reads .ps1 as ANSI/GBK unless a UTF-8 BOM is present, which
  // garbles the Chinese Write-Host strings and can break parsing — always ship
  // the apply script with a BOM.
  let psContent = fs.readFileSync(templatePath, 'utf8').replace(/^\uFEFF/, '');
  fs.writeFileSync(path.join(stage, 'apply-patch.ps1'), `\uFEFF${psContent}`, 'utf8');
  // One-click launcher for users who cannot right-click-run .ps1 (execution
  // policy): a plain-ASCII .cmd that runs the script with Bypass.
  fs.writeFileSync(path.join(stage, 'apply-patch.cmd'), [
    '@echo off',
    'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0apply-patch.ps1"',
    'pause',
    '',
  ].join('\r\n'), 'ascii');

  fs.mkdirSync(outDir, { recursive: true });
  const zipName = `patch-${baseline.version}-to-${version}.zip`;
  const zipPath = path.join(outDir, zipName);
  const safe = (s) => String(s).replace(/'/g, "''");
  execFileSync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-Command',
    `$ErrorActionPreference='Stop'; Compress-Archive -Path '${safe(stage)}\\*' -DestinationPath '${safe(zipPath)}' -Force`,
  ], { stdio: 'pipe' });

  writeManifest();
  console.log(
    `[make-patch] 生成补丁：patches\\${zipName}` +
    `（${changed.length} 个改动文件，已更新基线到 v${version}）`
  );
} finally {
  fs.rmSync(stage, { recursive: true, force: true });
}
