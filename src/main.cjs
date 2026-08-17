/**
 * DeepSeek Harness Desktop — Electron main process.
 * Spawns/manages the dsh web server and opens the GUI in a native window.
 */

const { app, BrowserWindow, shell, ipcMain, Menu, MenuItem, dialog } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { spawnHarnessServer, waitForReady, killHarness } = require('./harness.cjs');
const {
  readLocalePreference,
  writeLocalePreference,
  readSkinPreference,
  writeSkinPreference,
} = require('./settings.cjs');
const { DEFAULT_SKIN, listSkins, ensureSkinsDirectory, getSkinsDirectory, readSkinCss } = require('./skins.cjs');
const { installSkinFromGitHub } = require('./skin-install.cjs');
const { buildOverlayScript } = require('./fullscreen.cjs');
const { listPlugins, setPluginActive, installPlugin, removePlugin } = require('./plugins.cjs');

// Mirror console output into a log file: the packaged exe has no console
// window, so this is the only way to diagnose startup problems on a user box.
const LOG_PATH = path.join(os.tmpdir(), 'deepseek-harness-desktop.log');
try {
  const mirror = (level, stream, args) => {
    const line = `[${new Date().toISOString()}] [${level}] ${args.map((a) => {
      if (typeof a === 'string') return a;
      if (a instanceof Error) return a.stack || a.message;
      try { return JSON.stringify(a); } catch { return String(a); }
    }).join(' ')}\n`;
    try { fs.appendFileSync(LOG_PATH, line); } catch {}
    try { stream.write(line); } catch {}
  };
  console.log = (...args) => mirror('log', process.stdout, args);
  console.error = (...args) => mirror('error', process.stderr, args);
  console.warn = (...args) => mirror('warn', process.stderr, args);
} catch {
  // Logging is best-effort; the app must still run without it.
}

let mainWindow = null;
let harnessChild = null;
let harnessPort = 3080;
let harnessReused = false;
let isQuitting = false;

// --- Skin (theme) state -----------------------------------------------------
// Key returned by webContents.insertCSS for the currently-applied skin, so we
// can remove it before applying another (instant switch, no reload needed).
let activeSkinKey = null;
let skinApplySeq = 0; // guards against overlapping apply races
let lastSkinsSignature = ''; // used to rescan the skins menu lazily on open

/** Current skin id ('__default__' when none chosen). */
function currentSkinId() {
  return readSkinPreference() || DEFAULT_SKIN;
}

/** Stable fingerprint of the installed skin list (name + id). */
function skinsSignature() {
  try {
    return listSkins().map((s) => `${s.id}\u0000${s.name}`).join('\u0001');
  } catch {
    return '';
  }
}

/**
 * Apply a skin's CSS to the current page by swapping the inserted stylesheet.
 * Uses insertCSS/removeInsertedCSS (main-process, CSP-immune) so switching is
 * instant and does not reload the renderer.
 */
async function applySkin(id) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const seq = ++skinApplySeq;
  const css = readSkinCss(id);
  try {
    if (activeSkinKey) {
      const key = activeSkinKey;
      activeSkinKey = null;
      await mainWindow.webContents.removeInsertedCSS(key);
    }
    if (seq !== skinApplySeq) return; // superseded by a newer apply
    if (css) {
      activeSkinKey = await mainWindow.webContents.insertCSS(css);
    }
  } catch (error) {
    console.error('[desktop] Failed to apply skin:', error);
  }
}

/** Persist + apply a skin choice, then refresh the menu checkmarks. */
function setSkin(id) {
  try {
    writeSkinPreference(id);
  } catch (error) {
    console.error('[desktop] Failed to persist skin preference:', error);
  }
  applySkin(id);
  buildMenu();
}

/**
 * Toggle a plugin on/off. Bundle plugins need a harness restart; client UI
 * plugins only need the web page to reload (they are discovered on render).
 */
function togglePlugin(name, active) {
  let result;
  try {
    result = setPluginActive(name, active);
  } catch (error) {
    console.error('[desktop] Plugin toggle failed:', error);
    dialog.showMessageBox(mainWindow, {
      type: 'error',
      title: '插件切换失败',
      message: String((error && error.message) || error),
    });
    buildMenu();
    return;
  }
  buildMenu();
  if (result.type === 'client') {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.reload();
  } else {
    restartHarness().catch((error) => {
      console.error('[desktop] Harness restart failed:', error);
      dialog.showMessageBox(mainWindow, {
        type: 'error',
        title: '重启失败',
        message: `${(error && error.message) || error}\n\n请手动重启应用使插件切换生效。`,
      });
    });
  }
}

/** Open the skins folder in Explorer (creating it + a README on first use). */
function openSkinsFolder() {
  try {
    ensureSkinsDirectory();
    shell.openPath(getSkinsDirectory()).then((err) => {
      if (err) console.error('[desktop] Failed to open skins folder:', err);
    });
  } catch (error) {
    console.error('[desktop] Failed to open skins folder:', error);
  }
}

// --- GitHub skin installer dialog -------------------------------------------
let skinInstallWin = null;

/** Push a progress line to the install dialog (no-op when it is closed). */
function sendSkinStatus(text) {
  if (skinInstallWin && !skinInstallWin.isDestroyed()) {
    skinInstallWin.webContents.send('dsh-skin-install:status', String(text));
  }
}

/** Open the "Install from GitHub" modal dialog on the given tab (skin|plugin). */
function openSkinInstallDialog(tab = 'skin') {
  if (skinInstallWin && !skinInstallWin.isDestroyed()) {
    skinInstallWin.focus();
    return;
  }
  const zh = readLocalePreference() === 'zh';
  skinInstallWin = new BrowserWindow({
    width: 560,
    height: 420,
    resizable: false,
    minimizable: false,
    maximizable: false,
    parent: mainWindow || undefined,
    modal: Boolean(mainWindow),
    title: zh ? '从 GitHub 安装' : 'Install from GitHub',
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'skin-install-preload.cjs'),
    },
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
  });
  // The dialog is a small single-purpose window — drop the global menu bar
  // (File/Edit/View/…) that otherwise shows on every window on Windows.
  skinInstallWin.removeMenu();
  skinInstallWin.loadFile(path.join(__dirname, 'skin-install.html'), { query: { tab } });
  skinInstallWin.once('ready-to-show', () => {
    if (skinInstallWin) skinInstallWin.show();
  });
  skinInstallWin.on('closed', () => {
    skinInstallWin = null;
  });
}

/** Smoke test mode: capture a screenshot and exit. */
const SMOKE_MODE = process.env.DSH_DESKTOP_SMOKE === '1';
const SMOKE_OUTPUT = process.env.DSH_DESKTOP_SMOKE_OUTPUT || path.join(__dirname, '..', 'smoke-screenshot.png');

/** Escape a string for safe embedding in HTML text content. */
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}

/**
 * Build a data: URL that renders a simple error page. The title and detail are
 * HTML-escaped and the whole document is percent-encoded, so arbitrary error
 * messages (including non-ASCII text) render correctly and cannot inject markup.
 */
function errorPage(title, detail) {
  const html = [
    '<!doctype html><meta charset="utf-8">',
    '<body style="font-family:sans-serif;padding:2rem">',
    `<h1>${escapeHtml(title)}</h1>`,
    `<pre style="background:#111;color:#0f0;padding:1rem;overflow:auto">${escapeHtml(detail)}</pre>`,
    '</body>',
  ].join('');
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

/**
 * Switch the harness GUI language by writing the durable locale preference.
 * The settings-file provider hot-publishes the edit, so the UI flips live.
 */
function setLocale(preference) {
  try {
    writeLocalePreference(preference);
    console.log(`[desktop] Locale switched to ${preference}`);
  } catch (error) {
    console.error('[desktop] Failed to switch locale:', error);
  }
  buildMenu(); // refresh checkbox + label state
}

/**
 * Build the Skins submenu: a radio list of the default + installed skins,
 * followed by "open folder" and "refresh". Re-scans lazily on open so skins
 * dropped in while the app is running appear without a manual refresh.
 */
function buildSkinsSubmenu(L) {
  const current = currentSkinId();
  const submenu = new Menu();

  submenu.append(new MenuItem({
    label: L('默认', 'Default'),
    type: 'radio',
    checked: current === DEFAULT_SKIN,
    click: () => setSkin(DEFAULT_SKIN),
  }));

  for (const skin of listSkins()) {
    const label = skin.author ? `${skin.name} (${skin.author})` : skin.name;
    submenu.append(new MenuItem({
      label,
      type: 'radio',
      checked: current === skin.id,
      click: () => setSkin(skin.id),
    }));
  }

  submenu.append(new MenuItem({ type: 'separator' }));
  submenu.append(new MenuItem({ label: L('插件 / Plugins', 'Plugins'), enabled: false }));

  const plugins = listPlugins();
  if (plugins.length === 0) {
    submenu.append(new MenuItem({ label: L('（无插件）', '(none installed)'), enabled: false }));
  }
  for (const plugin of plugins) {
    submenu.append(new MenuItem({
      label: plugin.active ? `${plugin.name}  ✔` : plugin.name,
      type: 'checkbox',
      checked: plugin.active,
      click: () => togglePlugin(plugin.name, !plugin.active),
    }));
  }

  submenu.append(new MenuItem({ type: 'separator' }));
  submenu.append(new MenuItem({
    label: L('从 GitHub 安装皮肤…', 'Install Skin from GitHub…'),
    click: () => openSkinInstallDialog('skin'),
  }));
  submenu.append(new MenuItem({
    label: L('从 GitHub 安装插件…', 'Install Plugin from GitHub…'),
    click: () => openSkinInstallDialog('plugin'),
  }));
  submenu.append(new MenuItem({
    label: L('打开皮肤文件夹…', 'Open Skins Folder…'),
    click: () => openSkinsFolder(),
  }));
  submenu.append(new MenuItem({
    label: L('刷新列表', 'Refresh'),
    click: () => buildMenu(),
  }));

  // Rebuild only when the on-disk list actually changed, so opening the menu
  // does not disturb it unless there is something new to show.
  submenu.on('menu-will-show', () => {
    if (skinsSignature() !== lastSkinsSignature) buildMenu();
  });

  return submenu;
}

// --- Fullscreen -------------------------------------------------------------
/** Toggle the main window's fullscreen state. */
function toggleFullscreen() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.setFullScreen(!mainWindow.isFullScreen());
}

/**
 * Show/hide the in-page "exit fullscreen" overlay button (top-right corner).
 * Re-runs a single self-contained script that creates the button on first use.
 */
function applyFullscreenOverlay(visible) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const zh = readLocalePreference() === 'zh';
  const label = zh ? '退出全屏' : 'Exit Full Screen';
  mainWindow.webContents.executeJavaScript(buildOverlayScript(visible, label)).catch(() => {});
}

// --- Harness restart (for plugin activation changes) ------------------------
/**
 * Restart the harness child we spawned so a changed `dsh.profile.bundles`
 * layer list takes effect, then reload the window against the new server.
 * Refuses when the app reused an external harness (it does not own that one).
 */
async function restartHarness() {
  if (harnessReused) {
    throw new Error('当前连接的是外部 Harness，应用无法重启它（插件切换需要重启 Harness 生效）');
  }
  const old = harnessChild;
  await killHarness(old);
  const { child, port, reused } = await spawnHarnessServer({ port: harnessPort });
  harnessChild = child;
  harnessPort = port;
  harnessReused = reused;
  const serverUrl = await waitForReady(port, '127.0.0.1', 120000, child);
  console.log(`[desktop] Harness restarted on port ${port}`);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.loadURL(serverUrl).catch((err) => console.error('[desktop] Reload after restart failed:', err));
  }
  return serverUrl;
}

/** Build and install the application menu (labels follow the active locale). */
function buildMenu() {
  const current = readLocalePreference();
  const zh = current === 'zh';
  const L = (zhText, enText) => (zh ? zhText : enText);

  const template = [
    {
      label: L('文件', 'File'),
      submenu: [{ role: 'quit', label: L('退出', 'Exit') }],
    },
    {
      label: L('编辑', 'Edit'),
      submenu: [
        { role: 'undo', label: L('撤销', 'Undo') },
        { role: 'redo', label: L('重做', 'Redo') },
        { type: 'separator' },
        { role: 'cut', label: L('剪切', 'Cut') },
        { role: 'copy', label: L('复制', 'Copy') },
        { role: 'paste', label: L('粘贴', 'Paste') },
        { role: 'selectAll', label: L('全选', 'Select All') },
      ],
    },
    {
      label: L('视图', 'View'),
      submenu: [
        { role: 'reload', label: L('重新加载', 'Reload') },
        { role: 'toggleDevTools', label: L('开发者工具', 'Toggle DevTools') },
        { type: 'separator' },
        { role: 'resetZoom', label: L('实际大小', 'Actual Size') },
        { role: 'zoomIn', label: L('放大', 'Zoom In') },
        { role: 'zoomOut', label: L('缩小', 'Zoom Out') },
        { type: 'separator' },
        {
          label: (mainWindow && mainWindow.isFullScreen())
            ? L('退出全屏', 'Exit Full Screen')
            : L('全屏', 'Enter Full Screen'),
          accelerator: 'F11',
          click: () => toggleFullscreen(),
        },
      ],
    },
    {
      label: L('语言', 'Language'),
      submenu: [
        { label: '中文', type: 'checkbox', checked: current === 'zh', click: () => setLocale('zh') },
        { label: 'English', type: 'checkbox', checked: current === 'en', click: () => setLocale('en') },
      ],
    },
    {
      label: L('皮肤', 'Skins'),
      submenu: buildSkinsSubmenu(L),
    },
    {
      label: L('帮助', 'Help'),
      submenu: [
        {
          label: L('关于 DeepSeek Harness', 'About DeepSeek Harness'),
          click: () => {
            shell.openExternal('https://github.com/deepseek-ai/deepseek-harness');
          },
        },
      ],
    },
  ];

  lastSkinsSignature = skinsSignature();
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow(serverUrl) {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 768,
    title: 'DeepSeek Harness',
    show: SMOKE_MODE, // smoke mode shows immediately; normal mode waits for ready-to-show
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
  });

  // Open external links in system browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http:') || url.startsWith('https:')) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  // Re-apply the selected skin whenever the page (re)loads. insertCSS keys do
  // not survive a reload, so drop the stale key and inject the current skin.
  mainWindow.webContents.on('did-finish-load', () => {
    activeSkinKey = null;
    applySkin(currentSkinId());
    applyFullscreenOverlay(Boolean(mainWindow && mainWindow.isFullScreen()));
  });

  // Fullscreen overlay: show/hide the top-right "exit fullscreen" button and
  // refresh the menu label whenever the window enters or leaves fullscreen.
  mainWindow.on('enter-full-screen', () => {
    applyFullscreenOverlay(true);
    buildMenu();
  });
  mainWindow.on('leave-full-screen', () => {
    applyFullscreenOverlay(false);
    buildMenu();
  });

  if (SMOKE_MODE) {
    // Smoke: capture a screenshot once the page finishes loading, then exit.
    // Bound directly to did-finish-load (not ready-to-show) and guarded by a
    // safety timeout so the smoke run can never hang.
    const fs = require('fs');
    const smokeDone = async () => {
      if (isQuitting) return;
      if (!mainWindow.isVisible()) mainWindow.show();
      await new Promise((r) => setTimeout(r, 3000)); // let the React UI render
      try {
        const img = await mainWindow.webContents.capturePage();
        fs.writeFileSync(SMOKE_OUTPUT, img.toPNG());
        console.log(`[smoke] Screenshot saved to ${SMOKE_OUTPUT}`);
      } catch (e) {
        console.error('[smoke] Capture failed:', e && e.message ? e.message : e);
      }
      await shutdown();
      app.exit(0);
    };
    mainWindow.webContents.once('did-finish-load', smokeDone);
    setTimeout(smokeDone, 90000).unref();
  } else {
    mainWindow.once('ready-to-show', () => {
      mainWindow.show();
    });
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Load the harness GUI
  mainWindow.loadURL(serverUrl).catch((err) => {
    console.error('[desktop] Failed to load URL:', err);
    if (!SMOKE_MODE) {
      // Show error in window
      mainWindow.loadURL(errorPage('Failed to load DeepSeek Harness', err.message));
    }
  });

  return mainWindow;
}

async function startup() {
  console.log('[desktop] Starting DeepSeek Harness Desktop...');
  if (SMOKE_MODE) console.log('[desktop] SMOKE MODE enabled');

  buildMenu(); // install the native menu (language switching lives here)

  // Answer the renderer's version query. The sandboxed preload cannot read
  // package.json itself, so it asks the main process over IPC.
  ipcMain.on('dsh-desktop:get-version', (event) => {
    event.returnValue = app.getVersion();
  });

  // GitHub skin installer: run the download → extract → install pipeline.
  ipcMain.handle('dsh-desktop:install-skin', async (_event, url) => {
    try {
      const result = await installSkinFromGitHub(String(url || ''), sendSkinStatus);
      buildMenu(); // make the freshly installed skin show up immediately
      return { ok: true, ...result };
    } catch (error) {
      console.error('[desktop] Skin install failed:', error);
      return { ok: false, message: error && error.message ? error.message : String(error) };
    }
  });
  ipcMain.on('dsh-skin-install:close', () => {
    if (skinInstallWin) skinInstallWin.close();
  });
  ipcMain.on('dsh-skin-install:open-folder', () => openSkinsFolder());
  ipcMain.on('dsh-skin-install:switch-to', (_event, id) => setSkin(String(id || '')));
  ipcMain.on('dsh-desktop:set-fullscreen', (_event, flag) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setFullScreen(Boolean(flag));
  });

  // Plugin management: list installed bundles, install/remove/toggle via the
  // bundled `dsh plugin` CLI + the profile manifest.
  ipcMain.handle('dsh-desktop:list-plugins', async () => {
    try {
      return { ok: true, plugins: listPlugins() };
    } catch (error) {
      return { ok: false, message: String((error && error.message) || error) };
    }
  });
  ipcMain.handle('dsh-desktop:install-plugin', async (_event, spec) => {
    try {
      await installPlugin(String(spec || ''), sendSkinStatus);
      return { ok: true };
    } catch (error) {
      return { ok: false, message: String((error && error.message) || error) };
    }
  });
  ipcMain.handle('dsh-desktop:remove-plugin', async (_event, name) => {
    try {
      await removePlugin(String(name || ''), sendSkinStatus);
      return { ok: true };
    } catch (error) {
      return { ok: false, message: String((error && error.message) || error) };
    }
  });
  ipcMain.handle('dsh-desktop:toggle-plugin', async (_event, name, active) => {
    try {
      const result = setPluginActive(String(name || ''), Boolean(active));
      // bundle → restart harness; client → reload page (discovered on render).
      if (result.type === 'client') {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.reload();
      } else {
        restartHarness().catch((err) => console.error('[desktop] Harness restart failed:', err));
      }
      return { ok: true, ...result };
    } catch (error) {
      return { ok: false, message: String((error && error.message) || error) };
    }
  });

  // Ensure single instance
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    console.log('[desktop] Another instance is already running.');
    app.exit(0);
    return;
  }

  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  // Spawn/connect to harness server
  try {
    const preferredPort = Number(process.env.DSH_DESKTOP_PORT) || 3080;
    const { child, port, reused } = await spawnHarnessServer({ port: preferredPort });
    harnessChild = child;
    harnessPort = port;
    harnessReused = reused;
    console.log(`[desktop] Harness ${reused ? 'reused' : 'spawned'} on port ${port}`);

    // Wait for server readiness
    const serverUrl = await waitForReady(port, '127.0.0.1', 120000, child);
    console.log(`[desktop] Server ready: ${serverUrl}`);

    // Create and show window
    createWindow(serverUrl);
  } catch (err) {
    console.error('[desktop] Startup failed:', err);
    if (SMOKE_MODE) {
      // Smoke run must settle: report the failure and exit non-zero.
      await shutdown();
      app.exit(1);
      return;
    }
    // Show error window even if server failed
    const win = new BrowserWindow({
      width: 600,
      height: 400,
      title: 'DeepSeek Harness — Error',
      webPreferences: { nodeIntegration: false, contextIsolation: true },
    });
    win.loadURL(errorPage(
      'Failed to start DeepSeek Harness',
      `${err.message}\n\nCheck console for details. Set DSH_ROOT to your harness checkout root, or use a self-contained build.`,
    ));
  }
}

async function shutdown() {
  if (isQuitting) return;
  isQuitting = true;
  console.log('[desktop] Shutting down...');

  // Close window first
  if (mainWindow) {
    mainWindow.destroy();
    mainWindow = null;
  }

  // Kill harness if we spawned it (not reused)
  if (harnessChild && !harnessReused) {
    await killHarness(harnessChild);
  }
}

// App lifecycle
app.whenReady().then(startup);

app.on('window-all-closed', () => {
  // On macOS, keep app running; on Windows/Linux, quit
  if (process.platform !== 'darwin') {
    shutdown().then(() => app.exit(0));
  }
});

app.on('before-quit', (event) => {
  if (!isQuitting && harnessChild && !harnessReused) {
    event.preventDefault();
    shutdown().then(() => app.exit(0));
  }
});

// Handle uncaught errors
process.on('uncaughtException', (err) => {
  console.error('[desktop] Uncaught exception:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[desktop] Unhandled rejection:', reason);
});

module.exports = { createWindow, startup, shutdown };