/**
 * Install/refresh the bundled harness runtime (the npm-published @deepseek-ai/dsh
 * package) into harness-runtime/. This directory is packed into the app via
 * electron-builder's extraResources, making the desktop app self-contained.
 *
 * Usage: npm run prepare-runtime [version]
 *   version defaults to the latest published @deepseek-ai/dsh.
 */
const { execSync } = require('child_process');
const { existsSync, mkdirSync, rmSync } = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'harness-runtime');
const VERSION = process.argv[2] || 'latest';
const PKG = `@deepseek-ai/dsh@${VERSION}`;

console.log(`[prepare-runtime] Installing ${PKG} into ${ROOT} ...`);

if (existsSync(ROOT)) rmSync(ROOT, { recursive: true, force: true });
mkdirSync(ROOT, { recursive: true });

execSync(`npm install ${PKG} --omit=dev --no-audit --no-fund --loglevel=error`, {
  cwd: ROOT,
  stdio: 'inherit',
});

console.log('[prepare-runtime] Done. Bundled harness runtime is ready for packaging.');
