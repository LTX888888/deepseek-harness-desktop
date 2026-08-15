const { spawn } = require('child_process');
const path = require('path');

const electron = path.join(__dirname, '..', 'node_modules', 'electron', 'dist', 'electron.exe');
const child = spawn(electron, ['-e', 'console.log("STDOUT_TEST_OK"); console.error("STDERR_TEST_OK")'], {
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});

child.stdout.on('data', (d) => console.log('GOT_STDOUT:', JSON.stringify(d.toString())));
child.stderr.on('data', (d) => console.log('GOT_STDERR:', JSON.stringify(d.toString())));
child.on('error', (e) => console.log('SPAWN_ERROR:', e.message));
child.on('exit', (code) => { console.log('EXIT', code); process.exit(0); });
setTimeout(() => { console.log('TIMEOUT'); process.exit(2); }, 15000);
