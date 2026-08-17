/**
 * Plugin (bundle) management for the desktop app.
 *
 * dsh plugins live in the web profile (`~/.dsh/profiles/web/package.json`):
 *   - `dependencies`            → installed plugin packages (via pnpm)
 *   - `dsh.profile.bundles`     → which of them are ACTIVE layers
 *
 * "Switching" a plugin skin is just adding/removing its name in `bundles`
 * (no pnpm, no network) followed by a harness restart. Installing/removing is
 * delegated to `dsh plugin --profile web add|remove ...`, which forwards to
 * pnpm and reconciles the manifest.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const YAML = require('yaml');
const { resolveBundledRuntime } = require('./harness.cjs');
const { normalizeGitHubZipUrl, downloadToFile, extractZip } = require('./skin-install.cjs');

/** The web profile directory (`$DSH_HOME/profiles/web`). */
function profileDir() {
  const dshHome = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
  return path.join(dshHome, 'profiles', 'web');
}

function manifestPath() {
  return path.join(profileDir(), 'package.json');
}

/** Read the profile manifest (package.json), or null when not initialized. */
function readManifest() {
  try {
    return JSON.parse(fs.readFileSync(manifestPath(), 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return null;
  }
}

/** Atomic write of the profile manifest. */
function writeManifest(manifest) {
  const p = manifestPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, p);
}

/**
 * Installed plugins: [{ name, active, type }] where type is 'bundle' or
 * 'client'. Bundle plugins come from the profile manifest `dependencies`;
 * client plugins come from cordis.patch.yml (always active while registered).
 */
function listPlugins() {
  const m = readManifest();
  const result = [];
  if (m) {
    const bundles = new Set((m.dsh && m.dsh.profile && m.dsh.profile.bundles) || []);
    for (const name of Object.keys(m.dependencies || {})) {
      result.push({ name, active: bundles.has(name), type: 'bundle' });
    }
  }
  for (const p of listClientPlugins()) {
    result.push({ name: p.name, active: true, type: 'client' });
  }
  return result;
}

/**
 * Activate/deactivate a plugin. Routes by type:
 *   - bundle  → edit the manifest `dsh.profile.bundles` list
 *   - client  → register/unregister in cordis.patch.yml
 * Returns { name, active, type } after the change.
 */
function setPluginActive(name, active) {
  const m = readManifest();
  if (m && name in (m.dependencies || {})) {
    const bundles = (m.dsh && m.dsh.profile && m.dsh.profile.bundles) || [];
    const idx = bundles.indexOf(name);
    if (active && idx === -1) bundles.push(name);
    else if (!active && idx !== -1) bundles.splice(idx, 1);
    m.dsh = { ...(m.dsh || {}), profile: { ...((m.dsh && m.dsh.profile) || {}), bundles } };
    writeManifest(m);
    return { name, active, type: 'bundle' };
  }
  const client = listClientPlugins().find((p) => p.name === name);
  if (client) {
    if (active) registerClientPlugin(client.id, name);
    else unregisterClientPlugin(name);
    return { name, active, type: 'client' };
  }
  throw new Error(`未找到插件「${name}」`);
}

/**
 * Run `dsh plugin --profile web <args...>` through the bundled runtime.
 * Resolves once the process exits (0 = success). Progress lines are forwarded
 * to onOutput for UI display.
 */
function runDshPlugin(args, onOutput = () => {}) {
  return new Promise((resolve, reject) => {
    const bundled = resolveBundledRuntime();
    if (!bundled) {
      reject(new Error('未找到内置运行时，无法管理插件'));
      return;
    }
    const child = spawn(
      process.execPath,
      [bundled.bin, 'plugin', '--profile', 'web', ...args],
      {
        cwd: bundled.root,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', DSH_TELEMETRY_DISABLED: '1' },
        windowsHide: true,
        shell: false,
      },
    );
    let stderr = '';
    child.stdout.on('data', (d) => onOutput(d.toString()));
    child.stderr.on('data', (d) => { stderr += d.toString(); onOutput(d.toString()); });
    child.on('error', (err) => reject(err));
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error((stderr.trim().split('\n').slice(-3).join(' ') || `退出码 ${code}`).slice(0, 500)));
    });
  });
}

/** Convert a pnpm-style github spec or GitHub URL into an https repo URL. */
function specToUrl(spec) {
  const s = String(spec).trim();
  const m = s.match(/^github:([^/]+)\/([^#\s]+)/);
  if (m) return `https://github.com/${m[1]}/${m[2]}`;
  if (/^https?:\/\/(www\.)?github\.com\//.test(s)) return s;
  throw new Error('仅支持 github:owner/repo 或 GitHub 仓库地址');
}

/** Locate the directory containing package.json (handles the repo-branch wrapper). */
function findPackageDir(rootDir) {
  if (fs.existsSync(path.join(rootDir, 'package.json'))) return rootDir;
  const entries = fs.readdirSync(rootDir, { withFileTypes: true });
  for (const e of entries) {
    if (e.isDirectory() && fs.existsSync(path.join(rootDir, e.name, 'package.json'))) {
      return path.join(rootDir, e.name);
    }
  }
  throw new Error('压缩包里没有找到 package.json（不是有效的 dsh 插件仓库）');
}

// --- client plugins (dsh.client, registered via cordis.patch.yml) ------------
// Client UI plugins (e.g. glassmorphism themes) are NOT `dsh.bundle` layers.
// They are linked into `~/.dsh/profiles/node_modules` and registered in
// `~/.dsh/profiles/web/cordis.patch.yml` as an insert entry; the web frontend
// then discovers them on reload (no full harness restart needed).

function profilesNodeModulesDir() {
  return path.join(path.dirname(profileDir()), 'node_modules');
}
function cordisPatchPath() {
  return path.join(profileDir(), 'cordis.patch.yml');
}
function readCordisPatch() {
  try {
    const text = fs.readFileSync(cordisPatchPath(), 'utf8');
    if (!text.trim()) return [];
    const doc = YAML.parse(text);
    return Array.isArray(doc) ? doc : [];
  } catch {
    return [];
  }
}
function writeCordisPatch(arr) {
  const p = cordisPatchPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, `${YAML.stringify(arr) || '[]'}\n`, 'utf8');
  fs.renameSync(tmp, p);
}
function listClientPlugins() {
  const out = [];
  for (const entry of readCordisPatch()) {
    if (entry && Array.isArray(entry.insert)) {
      for (const item of entry.insert) {
        if (item && item.name) out.push({ id: item.id || item.name, name: item.name });
      }
    }
  }
  return out;
}
function registerClientPlugin(id, name) {
  const patch = readCordisPatch();
  const kept = [];
  for (const entry of patch) {
    if (entry && Array.isArray(entry.insert)) {
      const items = entry.insert.filter((it) => !(it && (it.name === name || it.id === id)));
      if (items.length) kept.push({ ...entry, insert: items });
    } else if (entry) {
      kept.push(entry);
    }
  }
  kept.push({ insert: [{ id, name }] });
  writeCordisPatch(kept);
}
function unregisterClientPlugin(name) {
  const patch = readCordisPatch();
  const kept = [];
  for (const entry of patch) {
    if (entry && Array.isArray(entry.insert)) {
      const items = entry.insert.filter((it) => !(it && (it.name === name || it.id === name)));
      if (items.length) kept.push({ ...entry, insert: items });
    } else if (entry) {
      kept.push(entry);
    }
  }
  writeCordisPatch(kept);
}

/** Install a client plugin from an already-extracted package directory. */
function installClientPluginFromDir(pkgDir, pkg, onOutput) {
  const name = pkg.name;
  if (!name) throw new Error('插件缺少 name 字段');
  onOutput(`识别为客户端插件「${name}」，正在安装…`);
  const target = path.join(profilesNodeModulesDir(), name);
  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(pkgDir, target, { recursive: true });
  const id = name.replace(/^@[^/]+\//, '').replace(/[^a-zA-Z0-9_-]+/g, '-');
  registerClientPlugin(id, name);
  onOutput(`已安装「${name}」，刷新界面即可生效`);
  return { name, active: true, type: 'client' };
}

/** Install a plugin: download, inspect its manifest, and route to the right mechanism. */
async function installPlugin(spec, onOutput = () => {}) {
  const url = specToUrl(spec);
  const zipPath = path.join(os.tmpdir(), `dsh-plugin-${process.pid}-${Date.now()}.zip`);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-plugin-'));
  try {
    onOutput('正在下载插件…');
    await downloadToFile(normalizeGitHubZipUrl(url), zipPath);
    const extractDir = path.join(tmp, 'extract');
    fs.mkdirSync(extractDir, { recursive: true });
    await extractZip(zipPath, extractDir);
    const pkgDir = findPackageDir(extractDir);
    const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8').replace(/^\uFEFF/, ''));

    if (pkg.dsh && pkg.dsh.bundle && pkg.dsh.bundle.patch !== undefined) {
      // Server-side bundle → official pnpm path (reconciles dsh.profile.bundles).
      onOutput('识别为服务端插件，正在安装（pnpm）…');
      await runDshPlugin(['add', String(spec)], onOutput);
      return { name: pkg.name, active: true, type: 'bundle' };
    }
    if (pkg.dsh && pkg.dsh.client) {
      return installClientPluginFromDir(pkgDir, pkg, onOutput);
    }
    throw new Error('不是有效的 dsh 插件：package.json 缺少 dsh.bundle 或 dsh.client 声明');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(zipPath, { force: true });
  }
}

/** Remove an installed plugin (bundle or client). */
function removePlugin(name, onOutput = () => {}) {
  const m = readManifest();
  if (m && name in (m.dependencies || {})) {
    return runDshPlugin(['remove', String(name)], onOutput);
  }
  const client = listClientPlugins().find((p) => p.name === name);
  if (client) {
    unregisterClientPlugin(name);
    fs.rmSync(path.join(profilesNodeModulesDir(), name), { recursive: true, force: true });
    onOutput(`已卸载「${name}」`);
    return Promise.resolve();
  }
  return Promise.reject(new Error(`未找到插件「${name}」`));
}

module.exports = {
  profileDir,
  manifestPath,
  readManifest,
  listPlugins,
  setPluginActive,
  installPlugin,
  removePlugin,
  listClientPlugins,
};
