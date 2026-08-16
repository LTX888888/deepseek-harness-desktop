/**
 * Headless test for the "Install Skin from GitHub" dialog window.
 *
 * Loads the dialog HTML + preload in a real Electron BrowserWindow, stubs the
 * install IPC handler, clicks the install button from the page, and asserts the
 * success state renders (status line + actions row). Exits 0 on pass, 1 on fail.
 *
 * Run: npx electron scripts/test-skin-install.cjs
 */
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

const EXPECTED_URL = 'https://github.com/octocat/Hello-World';

app.whenReady().then(async () => {
  ipcMain.handle('dsh-desktop:install-skin', async (_event, url) => {
    if (url !== EXPECTED_URL) return { ok: false, message: 'unexpected url: ' + url };
    return { ok: true, name: '测试皮肤', dest: 'C:\\fake', skinsDir: 'C:\\fake\\skins' };
  });

  let switchedTo = null;
  ipcMain.on('dsh-skin-install:switch-to', (_event, id) => {
    switchedTo = id;
  });

  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, '..', 'src', 'skin-install-preload.cjs'),
    },
  });

  const problems = [];
  win.webContents.on('console-message', (_e, _level, message) => {
    if (/error|failed/i.test(message)) problems.push(`console: ${message}`);
  });
  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    problems.push(`did-fail-load ${code} ${desc} ${url}`);
  });

  await win.loadFile(path.join(__dirname, '..', 'src', 'skin-install.html'));

  // Install, then confirm the switch prompt appears and clicking it fires IPC.
  const result = await win.webContents.executeJavaScript(`
    (async () => {
      await new Promise((r) => setTimeout(r, 300));
      document.getElementById('url').value = '${EXPECTED_URL}';
      document.getElementById('install').click();
      await new Promise((r) => setTimeout(r, 500));
      const afterInstall = {
        status: document.getElementById('status').textContent,
        statusClass: document.getElementById('status').className,
        confirmHidden: document.getElementById('confirm').hidden,
        actionsHidden: document.getElementById('actions').hidden,
      };
      document.getElementById('switch-now').click();
      await new Promise((r) => setTimeout(r, 200));
      const afterSwitch = {
        status: document.getElementById('status').textContent,
        confirmHidden: document.getElementById('confirm').hidden,
      };
      return { afterInstall, afterSwitch };
    })()
  `);

  console.log('RESULT:', JSON.stringify(result, null, 2));
  console.log('SWITCHED_TO:', JSON.stringify(switchedTo));
  console.log('PROBLEMS:', JSON.stringify(problems));

  const pass =
    problems.length === 0 &&
    result.afterInstall.status.includes('已安装') &&
    result.afterInstall.statusClass === 'ok' &&
    result.afterInstall.confirmHidden === false &&
    result.afterInstall.actionsHidden === false &&
    switchedTo === '测试皮肤' &&
    result.afterSwitch.status.includes('已切换') &&
    result.afterSwitch.confirmHidden === true;

  console.log(pass ? 'SKIN DIALOG TEST: PASS' : 'SKIN DIALOG TEST: FAIL');
  app.exit(pass ? 0 : 1);
});
