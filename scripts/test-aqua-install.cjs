// End-to-end: install the Aqua client UI plugin via installPlugin().
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-aqua-test-'));
process.env.DSH_HOME = HOME;
fs.mkdirSync(path.join(HOME, 'profiles', 'web'), { recursive: true });
fs.writeFileSync(path.join(HOME, 'profiles', 'web', 'cordis.patch.yml'), '[]\n');

const p = require('../src/plugins.cjs');

(async () => {
  const lines = [];
  const res = await p.installPlugin('github:WYH66666666/DSH-Transparent-UI-Plugin', (t) => lines.push(t.trim()));
  console.log('RESULT:', JSON.stringify(res));
  console.log('OUTPUT TAIL:', JSON.stringify(lines.slice(-3)));

  assert.strictEqual(res.type, 'client');
  assert.strictEqual(res.name, '@deepseek-ai/dsh-client-ui-aqua');

  const linked = path.join(HOME, 'profiles', 'node_modules', '@deepseek-ai', 'dsh-client-ui-aqua', 'lib', 'client.js');
  assert.ok(fs.existsSync(linked), 'client.js should be linked: ' + linked);

  const patch = fs.readFileSync(path.join(HOME, 'profiles', 'web', 'cordis.patch.yml'), 'utf8');
  assert.ok(patch.includes('dsh-client-ui-aqua'), 'cordis.patch.yml should register the plugin');

  const list = p.listPlugins();
  assert.deepStrictEqual(list, [{ name: '@deepseek-ai/dsh-client-ui-aqua', active: true, type: 'client' }]);

  console.log('cordis.patch.yml:', patch.trim());
  console.log('E2E CLIENT PLUGIN INSTALL: PASS');
  fs.rmSync(HOME, { recursive: true, force: true });
})().catch((e) => {
  console.error('FAIL', e);
  fs.rmSync(HOME, { recursive: true, force: true });
  process.exit(1);
});
