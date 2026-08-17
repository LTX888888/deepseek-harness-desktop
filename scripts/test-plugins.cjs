// Unit test: plugins.cjs bundle + client plugin management (new semantics:
// client plugins are discovered from profiles/node_modules; active = registered).
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-plug-test-'));
process.env.DSH_HOME = HOME;

const web = path.join(HOME, 'profiles', 'web');
fs.mkdirSync(web, { recursive: true });
fs.writeFileSync(path.join(web, 'package.json'), JSON.stringify({
  name: 'dsh-profile-web',
  private: true,
  dependencies: { '@x/bundle-a': '1.0.0' },
  dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@x/bundle-a'] } },
}, null, 2));
fs.writeFileSync(path.join(web, 'cordis.patch.yml'), '[]\n');

const p = require('../src/plugins.cjs');

// Create a client plugin in profiles/node_modules (as installClientPluginFromDir would)
const clientPkgDir = path.join(HOME, 'profiles', 'node_modules', '@deepseek-ai', 'dsh-client-ui-aqua');
fs.mkdirSync(clientPkgDir, { recursive: true });
fs.writeFileSync(path.join(clientPkgDir, 'package.json'), JSON.stringify({
  name: '@deepseek-ai/dsh-client-ui-aqua',
  dsh: { client: { inject: [], platform: 'web' } },
}));

// 1. bundle plugin listed; client plugin listed as INACTIVE (not yet registered)
let list = p.listPlugins();
assert.deepStrictEqual(list, [
  { name: '@x/bundle-a', active: true, type: 'bundle' },
  { name: '@deepseek-ai/dsh-client-ui-aqua', active: false, type: 'client' },
]);
console.log('1. initial list OK:', JSON.stringify(list));

// 2. register (activate) the client plugin
const on = p.setPluginActive('@deepseek-ai/dsh-client-ui-aqua', true);
assert.strictEqual(on.type, 'client');
assert.strictEqual(on.active, true);
list = p.listPlugins();
assert.deepStrictEqual(list[1], { name: '@deepseek-ai/dsh-client-ui-aqua', active: true, type: 'client' });
console.log('2. activate client OK');

// 3. toggle client off → STILL listed, active=false
const off = p.setPluginActive('@deepseek-ai/dsh-client-ui-aqua', false);
assert.strictEqual(off.active, false);
list = p.listPlugins();
assert.deepStrictEqual(list[1], { name: '@deepseek-ai/dsh-client-ui-aqua', active: false, type: 'client' });
console.log('3. client toggle-off keeps listing OK:', JSON.stringify(list));

// 4. toggle bundle off → still listed, active=false
const b = p.setPluginActive('@x/bundle-a', false);
assert.strictEqual(b.type, 'bundle');
assert.strictEqual(b.active, false);
console.log('4. bundle toggle-off OK:', JSON.stringify(p.listPlugins()));

// 5. ensureClientPlugins re-registers inactive client plugins
const restored = p.ensureClientPlugins();
assert.deepStrictEqual(restored, ['@deepseek-ai/dsh-client-ui-aqua']);
console.log('5. ensureClientPlugins re-registers OK:', JSON.stringify(p.listPlugins()));

console.log('PLUGINS UNIT TEST: PASS');
fs.rmSync(HOME, { recursive: true, force: true });
