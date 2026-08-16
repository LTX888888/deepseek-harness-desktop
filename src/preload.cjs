/**
 * Preload script for the harness desktop window.
 * Exposes minimal safe APIs to the renderer via contextBridge.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('dshDesktop', {
  // App version, fetched from the main process over IPC. A sandboxed preload
  // script cannot `require` arbitrary files (e.g. package.json) — doing so here
  // would throw at call time — so the main process supplies the version instead.
  getVersion: () => ipcRenderer.sendSync('dsh-desktop:get-version'),
  // Platform info
  platform: process.platform,
  // Signal that this is the desktop build
  isDesktop: true,
  // Ask the main process to enter/exit fullscreen (used by the in-page
  // "exit fullscreen" overlay button).
  setFullscreen: (flag) => ipcRenderer.send('dsh-desktop:set-fullscreen', Boolean(flag)),
});