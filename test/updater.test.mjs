import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

test('updater refreshes only its marketplace, preserves disabled state and never reinstalls', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aim2-update-test-'));
  const fake = join(dir, 'codex'); const log = join(dir, 'calls'); const changed = join(dir, 'changed');
  writeFileSync(fake, `#!/usr/bin/env node\nconst fs=require('node:fs'); const args=process.argv.slice(2); fs.appendFileSync(${JSON.stringify(log)},JSON.stringify(args)+'\\n'); if(args.includes('upgrade')){fs.writeFileSync(${JSON.stringify(changed)},'yes'); console.log(JSON.stringify({upgraded:true}));}else{console.log(JSON.stringify({installed:process.env.FAKE_UNINSTALLED ? [] : [{pluginId:'aim2@aim2-plugins',version:fs.existsSync(${JSON.stringify(changed)})?'0.1.1':'0.1.0',enabled:false}]}));}\n`, { mode: 0o700 });
  const state = join(dir, 'state');
  const env = { ...process.env, AIM2_CODEX_BIN: fake, AIM2_UPDATER_DATA_DIR: state };
  try {
    const r = spawnSync(process.execPath, [resolve('scripts/manage.mjs'), 'update'], { env, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const receipt = JSON.parse(readFileSync(join(state, 'last-update.json')));
    assert.equal(receipt.installedVersion, '0.1.1'); assert.equal(receipt.enabled, false);
    const calls = readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(calls.length, 3); assert.ok(calls.every(c => c.includes('aim2-plugins'))); assert.ok(calls.every(c => !c.includes('add')));
    assert.equal(existsSync(join(state, 'update.lock')), false);
    const stop = spawnSync(process.execPath, [resolve('scripts/manage.mjs'), 'update'], { env: { ...env, FAKE_UNINSTALLED: '1' }, encoding: 'utf8' });
    assert.equal(stop.status, 1); assert.match(stop.stderr, /uninstalled/);
    assert.equal(existsSync(join(state, 'update.lock')), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
