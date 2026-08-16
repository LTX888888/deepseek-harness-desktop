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
const { resolveBundledRuntime } = require('./harness.cjs');

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
 * Installed plugin skins: [{ name, active }].
 * Active means the package is present in `dsh.profile.bundles`.
 */
function listPlugins() {
  const m = readManifest();
  if (!m) return [];
  const bundles = new Set((m.dsh && m.dsh.profile && m.dsh.profile.bundles) || []);
  return Object.keys(m.dependencies || {}).map((name) => ({ name, active: bundles.has(name) }));
}

/**
 * Activate/deactivate a plugin bundle by editing the manifest bundles list.
 * Returns { name, active } after the change.
 */
function setPluginActive(name, active) {
  const m = readManifest();
  if (!m) throw new Error('未找到插件清单（请先安装一个插件以初始化插件系统）');
  const bundles = (m.dsh && m.dsh.profile && m.dsh.profile.bundles) || [];
  const idx = bundles.indexOf(name);
  if (active && idx === -1) bundles.push(name);
  else if (!active && idx !== -1) bundles.splice(idx, 1);
  m.dsh = { ...(m.dsh || {}), profile: { ...((m.dsh && m.dsh.profile) || {}), bundles } };
  writeManifest(m);
  return { name, active };
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

/** Install a plugin from a GitHub spec (github:owner/repo, git+https, etc.). */
function installPlugin(spec, onOutput = () => {}) {
  return runDshPlugin(['add', String(spec)], onOutput);
}

/** Remove an installed plugin by package name. */
function removePlugin(name, onOutput = () => {}) {
  return runDshPlugin(['remove', String(name)], onOutput);
}

module.exports = {
  profileDir,
  manifestPath,
  readManifest,
  listPlugins,
  setPluginActive,
  installPlugin,
  removePlugin,
};
