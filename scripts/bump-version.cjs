/**
 * Bump the app version so each build iteration produces a distinct artifact
 * name (the electron-builder artifactNames embed ${version}).
 *
 * Usage: node scripts/bump-version.cjs [patch|minor|major]   (default: patch)
 *
 * Updates package.json and, when present, package-lock.json.
 */
const fs = require('fs');
const path = require('path');

const root = process.env.BUMP_ROOT || path.join(__dirname, '..');
const pkgPath = path.join(root, 'package.json');
const lockPath = path.join(root, 'package-lock.json');

const which = process.argv[2] || 'patch';
if (!['patch', 'minor', 'major'].includes(which)) {
  console.error(`[bump] unknown part "${which}" (use patch|minor|major)`);
  process.exit(1);
}

const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const [major, minor, patch] = String(pkg.version).split('.').map(Number);

let next;
if (which === 'major') next = `${major + 1}.0.0`;
else if (which === 'minor') next = `${major}.${minor + 1}.0`;
else next = `${major}.${minor}.${patch + 1}`;

const old = pkg.version;
pkg.version = next;
fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');

if (fs.existsSync(lockPath)) {
  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  if (lock.version !== undefined) lock.version = next;
  if (lock.packages && lock.packages['']) lock.packages[''].version = next;
  fs.writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`, 'utf8');
}

console.log(`[bump] ${old} -> ${next} (${which})`);
