const { spawn } = require('child_process');
const path = require('path');

const base = path.join(__dirname, '..', 'release', 'win-unpacked');
const exe = path.join(base, 'DeepSeek Harness.exe');
const bin = path.join(base, 'resources', 'harness-runtime', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js');
const cwd = path.join(base, 'resources', 'harness-runtime');

console.log('exe:', exe);
console.log('bin:', bin);
console.log('cwd:', cwd);

const child = spawn(exe, [bin, 'web', '--host', '127.0.0.1', '--port', '3082'], {
  cwd,
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});

child.stdout.on('data', (d) => process.stdout.write('OUT: ' + d));
child.stderr.on('data', (d) => process.stderr.write('ERR: ' + d));
child.on('error', (e) => console.log('SPAWN_ERROR:', e.message));
child.on('exit', (code, signal) => { console.log('EXIT', code, signal); process.exit(0); });
setTimeout(() => { console.log('TIMEOUT (still running = good)'); process.exit(0); }, 30000);
