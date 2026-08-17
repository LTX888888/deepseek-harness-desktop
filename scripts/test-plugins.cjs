// Unit test: plugins.cjs client + bundle plugin management.
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

// 1. listPlugins shows bundle plugin
let list = p.listPlugins();
assert.deepStrictEqual(list, [{ name: '@x/bundle-a', active: true, type: 'bundle' }]);
console.log('1. bundle list OK:', JSON.stringify(list));

// 2. register a client plugin and see it merged
// (installClientPluginFromDir does this internally; here we write the same
// cordis.patch.yml entry it would produce)
fs.writeFileSync(path.join(web, 'cordis.patch.yml'), '- insert:\n    - id: aqua\n      name: \'@x/aqua\'\n');
list = p.listPlugins();
assert.deepStrictEqual(list, [
  { name: '@x/bundle-a', active: true, type: 'bundle' },
  { name: '@x/aqua', active: true, type: 'client' },
]);
console.log('2. merged list OK:', JSON.stringify(list));

// 3. toggle client plugin off (unregister)
const r = p.setPluginActive('@x/aqua', false);
assert.strictEqual(r.type, 'client');
assert.strictEqual(r.active, false);
list = p.listPlugins();
assert.deepStrictEqual(list, [{ name: '@x/bundle-a', active: true, type: 'bundle' }]);
console.log('3. client toggle-off OK');

// 4. toggle bundle plugin off
const r2 = p.setPluginActive('@x/bundle-a', false);
assert.strictEqual(r2.type, 'bundle');
assert.strictEqual(r2.active, false);
console.log('4. bundle toggle-off OK:', JSON.stringify(p.listPlugins()));

console.log('PLUGINS UNIT TEST: PASS');
fs.rmSync(HOME, { recursive: true, force: true });
