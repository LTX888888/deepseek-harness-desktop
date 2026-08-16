/**
 * Preload for the "Install Skin from GitHub" dialog window.
 * Bridges the dialog page to the main process over IPC (sandboxed renderer).
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('dshSkinInstaller', {
  // Run the download → extract → install pipeline. Resolves { ok, name?, dest?, skinsDir?, message? }.
  install: (url) => ipcRenderer.invoke('dsh-desktop:install-skin', url),
  // Receive progress text pushed from the main process.
  onStatus: (callback) => {
    ipcRenderer.on('dsh-skin-install:status', (_event, text) => callback(text));
  },
  // Switch to a just-installed skin (by skin id = its folder name).
  switchTo: (id) => ipcRenderer.send('dsh-skin-install:switch-to', id),
  close: () => ipcRenderer.send('dsh-skin-install:close'),
  openSkinsFolder: () => ipcRenderer.send('dsh-skin-install:open-folder'),
});
