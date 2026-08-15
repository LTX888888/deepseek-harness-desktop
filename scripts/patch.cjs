/**
 * Incremental patch: copy the current src/*.cjs over the installed app's
 * unpacked code (resources/app.asar.unpacked/src/), then the running app picks
 * up the changes on restart — no framework re-download, no installer rebuild.
 *
 * Usage: npm run patch   (requires a one-time install of a build with
 *                         asarUnpack enabled; older installs have no unpacked src)
 */
const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, '..', 'src');
const installDir = path.join(
  process.env.LOCALAPPDATA || '',
  'Programs',
  'deepseek-harness-desktop',
);
const unpackedSrc = path.join(installDir, 'resources', 'app.asar.unpacked', 'src');

if (!fs.existsSync(unpackedSrc)) {
  console.error(`[patch] 未找到已安装的代码目录：${unpackedSrc}`);
  console.error('[patch] 请先安装带增量支持（asarUnpack）的新版安装包，再使用 patch。');
  process.exit(1);
}

const files = fs.readdirSync(srcDir).filter((f) => f.endsWith('.cjs'));
if (files.length === 0) {
  console.error('[patch] src/ 下没有 .cjs 文件可复制。');
  process.exit(1);
}

for (const file of files) {
  fs.copyFileSync(path.join(srcDir, file), path.join(unpackedSrc, file));
  console.log(`[patch] 已覆盖 ${file}`);
}

console.log(`[patch] 完成：${files.length} 个代码文件已更新。重启应用即生效（框架无需重新下载）。`);
