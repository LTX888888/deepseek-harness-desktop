/**
 * Preload script for the harness desktop window.
 * Exposes minimal safe APIs to the renderer via contextBridge.
 */

const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('dshDesktop', {
  // App version from package.json
  getVersion: () => require('../package.json').version,
  // Platform info
  platform: process.platform,
  // Signal that this is the desktop build
  isDesktop: true,
});