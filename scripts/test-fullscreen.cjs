/**
 * Headless test for the fullscreen overlay button.
 *
 * Loads a page with the real preload, injects the overlay script (from
 * src/fullscreen.cjs), verifies the button shows/hides, and that clicking it
 * sends the "exit fullscreen" request over IPC. Exits 0 on pass, 1 on fail.
 *
 * Run: npx electron scripts/test-fullscreen.cjs
 */
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { buildOverlayScript, FULLSCREEN_BTN_ID } = require('../src/fullscreen.cjs');

app.whenReady().then(async () => {
  let setFullscreenArg = null;
  ipcMain.on('dsh-desktop:set-fullscreen', (_event, flag) => {
    setFullscreenArg = flag;
  });

  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, '..', 'src', 'preload.cjs'),
    },
  });

  const problems = [];
  win.webContents.on('console-message', (_e, _level, message) => {
    if (/error|failed/i.test(message)) problems.push(message);
  });

  await win.loadURL('data:text/html,<html><body><h1>fullscreen test</h1></body></html>');

  // Inject hidden → show → read state → click → check IPC.
  const result = await win.webContents.executeJavaScript(`
    (async () => {
      await new Promise((r) => setTimeout(r, 300));
      const run = (code) => new Promise((r) => { try { r(eval(code)); } catch (e) { r('ERR:' + e.message); } });
      await run(${JSON.stringify(buildOverlayScript(false, '退出全屏'))});
      const hiddenDisplay = document.getElementById('${FULLSCREEN_BTN_ID}').style.display;
      await run(${JSON.stringify(buildOverlayScript(true, '退出全屏'))});
      const shownDisplay = document.getElementById('${FULLSCREEN_BTN_ID}').style.display;
      const text = document.getElementById('${FULLSCREEN_BTN_ID}').textContent;
      document.getElementById('${FULLSCREEN_BTN_ID}').click();
      await new Promise((r) => setTimeout(r, 300));
      return { hiddenDisplay, shownDisplay, text };
    })()
  `);

  console.log('RESULT:', JSON.stringify(result));
  console.log('SET_FULLSCREEN_ARG:', JSON.stringify(setFullscreenArg));
  console.log('PROBLEMS:', JSON.stringify(problems));

  const pass =
    problems.length === 0 &&
    result.hiddenDisplay === 'none' &&
    result.shownDisplay === 'block' &&
    result.text === '退出全屏' &&
    setFullscreenArg === false;

  console.log(pass ? 'FULLSCREEN OVERLAY TEST: PASS' : 'FULLSCREEN OVERLAY TEST: FAIL');
  app.exit(pass ? 0 : 1);
});
