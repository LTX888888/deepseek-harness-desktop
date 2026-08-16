/**
 * GitHub skin installer for the desktop app.
 *
 * One-click install from GitHub: the user pastes a repo URL into the install
 * dialog, this module downloads the repo zip (or a release zip), extracts it,
 * locates the skin folder (the one containing skin.css) and installs it into
 * the skins directory (~/.dsh/skins/<name>) so it shows up in the Skins menu.
 *
 * Download uses Node's global fetch (follows redirects); extraction uses
 * Windows PowerShell's Expand-Archive — the app is Windows-only (nsis/portable),
 * so PowerShell 5.1 is always present on supported systems.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { getSkinsDirectory, ensureSkinsDirectory, readMeta } = require('./skins.cjs');

const ALLOWED_HOSTS = new Set(['github.com', 'www.github.com', 'codeload.github.com']);
const MAX_DOWNLOAD_BYTES = 200 * 1024 * 1024; // safety cap for a skin repo zip

/**
 * Turn whatever GitHub URL the user pasted into a downloadable zip URL.
 * Supported inputs:
 *   https://github.com/owner/repo                      → default branch (main→master) zip
 *   https://github.com/owner/repo/tree/branch          → that branch's zip
 *   https://github.com/owner/repo/archive/….zip        → used as-is
 *   https://github.com/owner/repo/releases/download/…/x.zip → used as-is
 *   https://codeload.github.com/…/zip/…                → used as-is
 */
function normalizeGitHubZipUrl(input) {
  let url;
  try {
    url = new URL(String(input).trim());
  } catch {
    throw new Error('无效的 URL，请粘贴完整的 GitHub 地址');
  }
  if (url.protocol !== 'https:') throw new Error('仅支持 https 的 GitHub 地址');
  if (!ALLOWED_HOSTS.has(url.hostname.toLowerCase())) {
    throw new Error('仅支持 GitHub 仓库地址（github.com）');
  }
  const p = url.pathname.replace(/\/+$/, '');

  if (p.toLowerCase().endsWith('.zip')) return `https://github.com${p}`;

  let m = p.match(/^\/([^/]+)\/([^/]+)\/tree\/(.+)$/);
  if (m) return `https://codeload.github.com/${m[1]}/${m[2]}/zip/refs/heads/${m[3]}`;

  m = p.match(/^\/([^/]+)\/([^/]+)$/);
  if (m) return `https://codeload.github.com/${m[1]}/${m[2]}/zip/refs/heads/main`;

  throw new Error('无法识别的 GitHub 地址（支持仓库主页、分支 tree 地址或 zip 直链）');
}

/** Download a URL to a file (follows redirects). Returns byte count. */
async function downloadToFile(url, dest) {
  const res = await fetch(url, {
    redirect: 'follow',
    headers: {
      'User-Agent': 'deepseek-harness-desktop',
      Accept: 'application/zip, application/octet-stream, */*',
    },
  });
  if (!res.ok) {
    throw new Error(`下载失败：HTTP ${res.status} ${(res.statusText || '').trim()}`.replace(/\s+$/, ''));
  }
  const declared = Number(res.headers.get('content-length') || 0);
  if (declared > MAX_DOWNLOAD_BYTES) throw new Error('文件过大（超过 200MB），已取消');
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_DOWNLOAD_BYTES) throw new Error('文件过大（超过 200MB），已取消');
  if (buf.length === 0) throw new Error('下载内容为空');
  if (buf[0] !== 0x50 || buf[1] !== 0x4b) throw new Error('下载的文件不是有效的 zip 压缩包');
  fs.writeFileSync(dest, buf);
  return buf.length;
}

/** Extract a zip archive with Windows PowerShell's Expand-Archive. */
function extractZip(zipPath, destDir) {
  return new Promise((resolve, reject) => {
    const safe = (s) => String(s).replace(/'/g, "''");
    const cmd = `$ErrorActionPreference='Stop'; Expand-Archive -LiteralPath '${safe(zipPath)}' -DestinationPath '${safe(destDir)}' -Force`;
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', cmd], {
      windowsHide: true,
      timeout: 180000,
      maxBuffer: 1024 * 1024,
    }, (err, _stdout, stderr) => {
      if (err) {
        const detail = String(stderr || err.message || '').trim().split('\n').slice(-3).join(' ');
        reject(new Error(`解压失败：${detail || err.message}`));
      } else {
        resolve();
      }
    });
  });
}

/**
 * Breadth-first search (up to maxDepth) for the folder containing skin.css.
 * Returns the first (shallowest) match, or null.
 */
function findSkinRoot(rootDir, maxDepth = 3) {
  const queue = [{ dir: rootDir, depth: 0 }];
  while (queue.length) {
    const { dir, depth } = queue.shift();
    if (depth > maxDepth) continue;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    if (entries.some((e) => e.isFile() && e.name.toLowerCase() === 'skin.css')) return dir;
    for (const e of entries) {
      if (e.isDirectory()) queue.push({ dir: path.join(dir, e.name), depth: depth + 1 });
    }
  }
  return null;
}

/**
 * Extract an already-downloaded skin zip into the skins directory as <name>/.
 * Overwrites an existing skin with the same name. Returns { name, dest }.
 */
async function extractAndInstallSkin(zipPath) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-skin-'));
  try {
    const extractDir = path.join(tmp, 'extract');
    fs.mkdirSync(extractDir, { recursive: true });
    await extractZip(zipPath, extractDir);

    const skinRoot = findSkinRoot(extractDir);
    if (!skinRoot) throw new Error('压缩包里没有找到皮肤：缺少 skin.css 文件');

    const meta = readMeta(path.join(skinRoot, 'skin.json'));
    const rawName = (meta && meta.name) || path.basename(skinRoot) || 'skin';
    const name = String(rawName).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim() || 'skin';

    const skinsDir = ensureSkinsDirectory();
    const dest = path.join(skinsDir, name);
    fs.rmSync(dest, { recursive: true, force: true }); // overwrite on re-install
    fs.cpSync(skinRoot, dest, { recursive: true });
    return { name, dest };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * Full pipeline: GitHub URL → download → extract → install.
 * Falls back from the main branch to master when a bare repo URL 404s.
 * Returns { name, dest, skinsDir }.
 */
async function installSkinFromGitHub(input, onStatus = () => {}) {
  const zipUrl = normalizeGitHubZipUrl(input);
  const zipPath = path.join(os.tmpdir(), `dsh-skin-download-${process.pid}-${Date.now()}.zip`);
  try {
    onStatus('正在从 GitHub 下载…');
    let bytes;
    try {
      bytes = await downloadToFile(zipUrl, zipPath);
    } catch (error) {
      // A bare repo URL uses the main branch; if the repo's default branch is
      // master, GitHub answers 404 — retry once with master.
      if (/HTTP (404|409|400)/.test(error.message) && zipUrl.includes('/zip/refs/heads/main')) {
        const masterUrl = zipUrl.replace('/zip/refs/heads/main', '/zip/refs/heads/master');
        onStatus('main 分支不存在，尝试 master 分支…');
        bytes = await downloadToFile(masterUrl, zipPath);
      } else {
        throw error;
      }
    }
    onStatus(`下载完成（${(bytes / 1024 / 1024).toFixed(1)} MB），正在解压安装…`);
    const { name, dest } = await extractAndInstallSkin(zipPath);
    onStatus(`已安装「${name}」，可在菜单「皮肤」中切换`);
    return { name, dest, skinsDir: path.dirname(dest) };
  } finally {
    fs.rmSync(zipPath, { force: true });
  }
}

module.exports = {
  normalizeGitHubZipUrl,
  downloadToFile,
  extractZip,
  findSkinRoot,
  extractAndInstallSkin,
  installSkinFromGitHub,
};
