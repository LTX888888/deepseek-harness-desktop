/**
 * DeepSeek Harness Desktop — Electron main process.
 * Spawns/manages the dsh web server and opens the GUI in a native window.
 */

const { app, BrowserWindow, shell, ipcMain, Menu } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { spawnHarnessServer, waitForReady, killHarness } = require('./harness.cjs');
const { readLocalePreference, writeLocalePreference } = require('./settings.cjs');

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

/** Smoke test mode: capture a screenshot and exit. */
const SMOKE_MODE = process.env.DSH_DESKTOP_SMOKE === '1';
const SMOKE_OUTPUT = process.env.DSH_DESKTOP_SMOKE_OUTPUT || path.join(__dirname, '..', 'smoke-screenshot.png');

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
        { role: 'togglefullscreen', label: L('全屏', 'Toggle Full Screen') },
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
      mainWindow.loadURL(`data:text/html,<h1>Failed to load DeepSeek Harness</h1><pre>${err.message}</pre>`);
    }
  });

  return mainWindow;
}

async function startup() {
  console.log('[desktop] Starting DeepSeek Harness Desktop...');
  if (SMOKE_MODE) console.log('[desktop] SMOKE MODE enabled');

  buildMenu(); // install the native menu (language switching lives here)

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
    win.loadURL(`data:text/html,
      <html><body style="font-family:sans-serif;padding:2rem">
      <h1>Failed to start DeepSeek Harness</h1>
      <pre style="background:#111;color:#0f0;padding:1rem;overflow:auto">${err.message}</pre>
      <p>Check console for details. Set DSH_ROOT to your harness checkout root, or use a self-contained build.</p>
      </body></html>
    `);
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