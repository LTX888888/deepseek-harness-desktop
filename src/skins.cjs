/**
 * Skin (theme) management for the desktop app.
 *
 * Skins live in `$DSH_HOME/skins` (default `~/.dsh/skins`) so they are shared
 * with any other DeepSeek Harness install and survive app upgrades. Two layouts
 * are supported, so users can drop files straight out of a GitHub download:
 *
 *   1. A single CSS file:   skins/my-theme.css
 *   2. A folder:            skins/my-theme/skin.css   (+ optional skin.json)
 *
 * skin.json is optional metadata: { name, author, version, description }.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

/** The special id that means "no skin" (built-in default look). */
const DEFAULT_SKIN = '__default__';

/** Resolve the skins directory (`$DSH_HOME/skins` or `~/.dsh/skins`). */
function getSkinsDirectory() {
  const dshHome = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
  return path.join(dshHome, 'skins');
}

const README_TEXT = `DeepSeek Harness 皮肤目录 / Skins folder
===========================================

把皮肤放到这个文件夹，即可在应用菜单栏的「皮肤 / Skins」里切换。
Put skins in this folder to switch them from the app's "皮肤 / Skins" menu.

两种格式 / Two formats
----------------------
1) 单个 CSS 文件 — 直接把 my-theme.css 放进本目录。
   A single CSS file — drop my-theme.css directly here.

2) 皮肤文件夹 — 一个文件夹里包含 skin.css（必需）和可选的 skin.json。
   A folder containing skin.css (required) and an optional skin.json.

skin.json 示例 / example
------------------------
{
  "name": "我的皮肤",
  "author": "作者",
  "version": "1.0.0",
  "description": "说明"
}

从 GitHub 下载的皮肤：解压 zip 后，把包含 skin.css 的文件夹整个放进这里即可。
For skins downloaded from GitHub: extract the zip, then drop the folder
containing skin.css into this folder.

更方便：在应用菜单「皮肤 → 从 GitHub 安装皮肤…」里直接粘贴仓库地址，一键下载安装。
Easier: use the app menu "皮肤 → 从 GitHub 安装皮肤…" and paste the repo URL
to download and install a skin in one click.
`;

/** Create the skins directory (and a README) if it does not exist yet. */
function ensureSkinsDirectory() {
  const dir = getSkinsDirectory();
  fs.mkdirSync(dir, { recursive: true });
  const readme = path.join(dir, 'README.txt');
  if (!fs.existsSync(readme)) {
    try { fs.writeFileSync(readme, README_TEXT, 'utf8'); } catch { /* best-effort */ }
  }
  return dir;
}

/** Read optional skin.json metadata (never throws). */
function readMeta(file) {
  try {
    const raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''); // strip BOM
    const obj = JSON.parse(raw);
    return obj && typeof obj === 'object' ? obj : null;
  } catch {
    return null;
  }
}

/**
 * Scan the skins directory and return an array of skins:
 * [{ id, name, author?, version?, description?, css }], sorted by name.
 * Never throws — an unreadable/uncreatable folder simply yields an empty list,
 * so a skin-directory problem can never stop the app from starting.
 */
function listSkins() {
  let dir;
  try {
    dir = ensureSkinsDirectory();
  } catch {
    return [];
  }

  const skins = [];

  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return skins;
  }

  for (const entry of entries) {
    try {
      if (entry.isDirectory()) {
        const cssPath = path.join(dir, entry.name, 'skin.css');
        if (!fs.existsSync(cssPath)) continue;
        const meta = readMeta(path.join(dir, entry.name, 'skin.json'));
        skins.push({
          id: entry.name,
          name: (meta && meta.name) || entry.name,
          author: meta && meta.author,
          version: meta && meta.version,
          description: meta && meta.description,
          css: fs.readFileSync(cssPath, 'utf8'),
        });
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.css')) {
        const cssPath = path.join(dir, entry.name);
        skins.push({
          id: entry.name,
          name: entry.name.slice(0, -4), // strip .css
          css: fs.readFileSync(cssPath, 'utf8'),
        });
      }
    } catch { /* skip a broken skin entry */ }
  }

  skins.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  return skins;
}

/**
 * Return the CSS for a skin id, or '' for the default skin / unknown ids.
 */
function readSkinCss(id) {
  if (!id || id === DEFAULT_SKIN) return '';
  const skin = listSkins().find((s) => s.id === id);
  return skin ? skin.css : '';
}

module.exports = {
  DEFAULT_SKIN,
  getSkinsDirectory,
  ensureSkinsDirectory,
  listSkins,
  readSkinCss,
  readMeta,
};
