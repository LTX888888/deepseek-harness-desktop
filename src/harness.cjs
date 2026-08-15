/**
 * Harness server management for the desktop app.
 * Locates the dsh checkout, picks a port, spawns `dsh web`, and waits for readiness.
 */

const { spawn } = require('child_process');
const { resolve, join } = require('path');
const os = require('os');
const { existsSync } = require('fs');
const http = require('http');

/**
 * Resolve the bundled harness runtime shipped inside the packaged app
 * (resources/harness-runtime, populated from the npm-published @deepseek-ai/dsh
 * package). Returns null when not packaged (dev mode).
 */
function resolveBundledRuntime() {
  if (!process.resourcesPath) return null;
  const root = join(process.resourcesPath, 'harness-runtime');
  const bin = join(root, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js');
  if (existsSync(bin)) return { type: 'bundled', root, bin };
  return null;
}

/**
 * Resolve the harness root directory (dev-mode fallback only; the packaged app
 * always uses the bundled runtime).
 * Order: DSH_ROOT env → a checkout in the user's home directory.
 */
function findHarnessRoot() {
  const envRoot = process.env.DSH_ROOT;
  if (envRoot && existsSync(resolve(envRoot, 'apps', 'cli', 'src', 'bin.ts'))) {
    return resolve(envRoot);
  }
  const homeCandidate = join(os.homedir(), 'deepseek-harness');
  if (existsSync(resolve(homeCandidate, 'apps', 'cli', 'src', 'bin.ts'))) {
    return homeCandidate;
  }
  // Fallback: try to find `dsh` on PATH and infer root from its location
  // (Not implemented; user should set DSH_ROOT if not in default location)
  throw new Error(
    `Cannot locate DeepSeek Harness checkout. ` +
    `Set DSH_ROOT environment variable to the harness root (containing apps/cli/src/bin.ts).`
  );
}

/**
 * Check if a port is free by attempting to bind.
 * Returns true if free, false if occupied.
 */
function isPortFree(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const server = require('net').createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, host);
  });
}

/**
 * Pick a port starting from preferred (default 3080).
 * If preferred is free, use it. Else if occupied by a harness server, reuse it.
 * Else find next free port.
 */
async function pickPort(preferred = 3080, host = '127.0.0.1') {
  const free = await isPortFree(preferred, host);
  if (free) return { port: preferred, reused: false };
  // Port occupied - probe if it's a harness server
  const isHarness = await probeHarness(preferred, host);
  if (isHarness) {
    console.log(`[desktop] Port ${preferred} already serving harness — reusing.`);
    return { port: preferred, reused: true };
  }
  // Find next free port
  for (let p = preferred + 1; p < preferred + 100; p++) {
    const f = await isPortFree(p, host);
    if (f) {
      console.log(`[desktop] Port ${preferred} busy, using ${p}.`);
      return { port: p, reused: false };
    }
  }
  throw new Error(`No free port found near ${preferred}`);
}

/**
 * Probe a port to see if it's serving the DeepSeek Harness GUI.
 * Checks for the __DSH_BOOT__ marker in the HTML response.
 */
function probeHarness(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const req = http.request(
      { host, port, path: '/', method: 'GET', timeout: 3000 },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          // Harness index.html contains the __DSH_BOOT__ script injection
          resolve(data.includes('__DSH_BOOT__') || data.includes('DeepSeek Harness'));
        });
      }
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.end();
  });
}

/**
 * Spawn the `dsh web` server as a child process.
 * Returns { child, port, reused }.
 * If reused=true, child is null (connected to existing server).
 */
async function spawnHarnessServer(options = {}) {
  const { port: preferredPort = 3080, host = '127.0.0.1' } = options;
  const pick = await pickPort(preferredPort, host);
  if (pick.reused) {
    return { child: null, port: pick.port, reused: true };
  }
  const port = pick.port;

  // Prefer the bundled runtime shipped in the packaged app; fall back to a
  // checkout (dev mode) when there is none.
  const bundled = resolveBundledRuntime();
  let child;
  if (bundled) {
    console.log(`[desktop] Starting bundled harness at ${bundled.bin} on port ${port}...`);
    // Electron's executable doubles as the Node runtime (ELECTRON_RUN_AS_NODE).
    child = spawn(process.execPath, [bundled.bin, 'web', '--host', host, '--port', String(port)], {
      cwd: bundled.root,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', DSH_TELEMETRY_DISABLED: '1' },
      windowsHide: true,
    });
  } else {
    const harnessRoot = findHarnessRoot();
    console.log(`[desktop] Starting checkout harness at ${harnessRoot} on port ${port}...`);
    // Same invocation as a dev checkout: node --import tsx/esm apps/cli/src/bin.ts web ...
    child = spawn('node', [
      '--import', 'tsx/esm',
      'apps/cli/src/bin.ts',
      'web',
      '--host', host,
      '--port', String(port),
    ], {
      cwd: harnessRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, DSH_TELEMETRY_DISABLED: '1' },
      windowsHide: true,
    });
  }

  child.stdout.on('data', (data) => {
    const str = data.toString();
    try { process.stdout.write(`[harness] ${str}`); } catch {}
    // The harness prints "dsh web: http://127.0.0.1:<port>" when ready
    if (str.includes('dsh web:')) {
      child.emit('ready-url', str.trim());
    }
  });
  child.stderr.on('data', (data) => {
    try { process.stderr.write(`[harness:err] ${data}`); } catch {}
    child.harnessLog = (child.harnessLog || '') + data.toString();
  });
  child.on('error', (error) => {
    console.error(`[desktop] Failed to spawn harness process: ${error.message}`);
    child.spawnError = error;
  });

  return { child, port, reused: false };
}

/**
 * Wait for the harness server to be ready (HTTP 200 on /).
 * @param port - server port
 * @param host - bind host
 * @param timeoutMs - readiness deadline
 * @param child - the spawned harness child (if any); a premature exit fails fast
 */
async function waitForReady(port, host = '127.0.0.1', timeoutMs = 120000, child = null) {
  const deadline = Date.now() + timeoutMs;
  const url = `http://${host}:${port}/`;

  while (Date.now() < deadline) {
    if (child) {
      if (child.spawnError) {
        throw new Error(`Harness process failed to spawn: ${child.spawnError.message}`);
      }
      if (child.exitCode !== null || child.signalCode !== null) {
        const log = (child.harnessLog || '').trim().split('\n').slice(-5).join(' | ');
        throw new Error(`Harness process exited before ready (code ${child.exitCode}, signal ${child.signalCode})${log ? `; last output: ${log}` : ''}`);
      }
    }
    try {
      await new Promise((resolve, reject) => {
        const req = http.request({ host, port, path: '/', method: 'GET', timeout: 2000 }, (res) => {
          res.resume();
          if (res.statusCode === 200) resolve();
          else reject(new Error(`HTTP ${res.statusCode}`));
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
        req.end();
      });
      console.log(`[desktop] Harness ready at ${url}`);
      return url;
    } catch (e) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error(`Timed out waiting for harness at ${url} after ${timeoutMs}ms`);
}

/**
 * Gracefully terminate the spawned harness child process.
 */
function killHarness(child) {
  if (!child || child.killed) return Promise.resolve();
  console.log('[desktop] Stopping harness server...');
  return new Promise((resolve) => {
    const killed = child.kill('SIGTERM');
    if (!killed) {
      // Force kill on Windows
      try { process.kill(child.pid, 'SIGKILL'); } catch {}
    }
    child.on('exit', () => {
      console.log('[desktop] Harness server stopped.');
      resolve();
    });
    // Fallback timeout
    setTimeout(() => {
      try { process.kill(child.pid, 'SIGKILL'); } catch {}
      resolve();
    }, 5000);
  });
}

module.exports = {
  findHarnessRoot,
  pickPort,
  probeHarness,
  spawnHarnessServer,
  waitForReady,
  killHarness,
};