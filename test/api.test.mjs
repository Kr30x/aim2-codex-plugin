import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { Aim2Client, validateConfig } from '../dist/client.mjs';

test('MCP package: catalogs, paging, guarded writes, deduplication and safe errors', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'aim2-plugin-test-'));
  const key = 'synthetic-test-key'; const tokenFile = join(dir, 'key'); const configPath = join(dir, 'config.json');
  writeFileSync(tokenFile, key, { mode: 0o600 });
  let basket = { id: 1, name: 'Synthetic', revision_id: 2, content: [{ text: 'one' }, { text: 'two', labels: ['demo'] }] };
  const calls = []; const launches = new Map(); let redirected = false;
  const http = createServer(async (req, res) => {
    assert.equal(req.headers.authorization, `Bearer ${key}`);
    const url = new URL(req.url, 'http://localhost'); const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString(); const body = raw ? JSON.parse(raw) : undefined;
    calls.push({ method: req.method, path: url.pathname, body });
    res.setHeader('Content-Type', 'application/json');
    const send = data => res.end(JSON.stringify(data));
    if (url.pathname === '/api/auth/me') return send({ id: 'test-user', username: 'demo' });
    if (url.pathname === '/api/baskets/catalog') return send([{ id: 1, name: basket.name, query_count: basket.content.length }]);
    if (url.pathname === '/api/baskets/1' && req.method === 'GET') return send(basket);
    if (url.pathname === '/api/baskets/1' && req.method === 'PUT') {
      if (body.expected_revision_id !== basket.revision_id) { res.statusCode = 409; return send({ detail: key }); }
      basket = { ...basket, ...body, revision_id: basket.revision_id + 1 }; return send(basket);
    }
    if (url.pathname === '/api/experiments/9/instances' && req.method === 'POST') {
      if (!launches.has(body.request_id)) launches.set(body.request_id, { id: launches.size + 10, status: 'queued' });
      return send(launches.get(body.request_id));
    }
    if (url.pathname === '/api/crons/4/instantiate') return send({ id: 88, status: 'queued', request_id: body.request_id });
    if (url.pathname === '/api/crons/4/enabled') return send({ id: 4, revision: 6, enabled: body.enabled });
    if (url.pathname === '/api/crons/4') return send({ id: 4, revision: 6, enabled: false });
    if (url.pathname === '/api/redirect') { res.statusCode = 302; res.setHeader('Location', '/api/leak'); return res.end(); }
    if (url.pathname === '/api/leak') { redirected = true; return send({ key }); }
    if (url.pathname === '/api/secret') return send({ echo: key });
    if (url.pathname === '/api/unauthorized') { res.statusCode = 401; return send({ detail: key }); }
    res.statusCode = 404; send({ detail: 'Not found' });
  });
  await new Promise(resolve => http.listen(0, '127.0.0.1', resolve));
  const config = { apiBase: `http://127.0.0.1:${http.address().port}/api`, tokenFile };
  writeFileSync(configPath, JSON.stringify(config), { mode: 0o600 });
  const client = new Client({ name: 'test', version: '1.0.0' });
  const mcp = JSON.parse(readFileSync('plugins/aim2/.mcp.json')).mcpServers.aim2;
  const transport = new StdioClientTransport({ command: mcp.command, args: mcp.args, cwd: resolve('plugins/aim2', mcp.cwd), env: { ...process.env, AIM2_CONFIG: configPath }, stderr: 'pipe' });
  try {
    await client.connect(transport);
    const tools = (await client.listTools()).tools;
    assert.equal(tools.length, 7);
    assert.equal(tools.find(t => t.name === 'aim2_save_basket').annotations.readOnlyHint, false);
    async function invoke(name, args = {}) { const r = await client.callTool({ name, arguments: args }); return { ...r, data: r.isError ? r.content[0].text : JSON.parse(r.content[0].text) }; }
    assert.equal((await invoke('aim2_connection')).data.user.username, 'demo');
    assert.equal((await invoke('aim2_list', { kind: 'baskets', limit: 1 })).data.next_offset, 1);
    const page = (await invoke('aim2_get', { kind: 'basket', id: 1, offset: 1, limit: 1 })).data;
    assert.equal(page.content_total, 2); assert.deepEqual(page.content, [basket.content[1]]); assert.equal(page.next_offset, null);
    const before = calls.length;
    assert.equal((await invoke('aim2_save_basket', { id: 1, name: 'Changed', content: [] })).isError, true);
    assert.equal(calls.length, before, 'invalid revision never reaches the API');
    const saved = await invoke('aim2_save_basket', { id: 1, expected_revision_id: 2, name: 'Changed', content: [{ text: 'new', region: 1 }] });
    assert.equal(saved.data.read_back_verified, true); assert.equal(saved.data.revision_id, 3);
    const conflict = await invoke('aim2_save_basket', { id: 1, expected_revision_id: 2, name: 'Stale', content: [] });
    assert.equal(conflict.isError, true); assert.match(conflict.data, /409/); assert.ok(!conflict.data.includes(key));
    const requestId = (await invoke('aim2_request_id')).data.request_id;
    const a = await invoke('aim2_start', { kind: 'experiment', id: 9, request_id: requestId });
    const b = await invoke('aim2_start', { kind: 'experiment', id: 9, request_id: requestId });
    assert.deepEqual(a.data, b.data); assert.equal(launches.size, 1);
    assert.equal((await invoke('aim2_start', { kind: 'cron', id: 4, request_id: requestId })).data.id, 88);
    assert.equal((await invoke('aim2_set_cron_enabled', { id: 4, enabled: false, expected_revision: 5 })).data.read_back_verified, true);
    const api = new Aim2Client(config);
    await assert.rejects(api.request('/redirect'), /redirect/); assert.equal(redirected, false);
    assert.deepEqual(await api.request('/secret'), { echo: '[REDACTED]' });
    await assert.rejects(api.request('/unauthorized'), e => /401/.test(e.message) && !e.message.includes(key));
    await assert.rejects(api.request('//evil.example'), /Invalid API path/);
  } finally { await client.close(); await new Promise(resolve => http.close(resolve)); rmSync(dir, { recursive: true, force: true }); }
});

test('configuration rejects credential URLs and accidental insecure remote transports', () => {
  const tokenFile = '/tmp/synthetic-token';
  assert.throws(() => validateConfig({ apiBase: 'https://user:pass@example.com/api', tokenFile }), /credentials/);
  assert.throws(() => validateConfig({ apiBase: 'http://example.com/api', tokenFile }), /HTTPS/);
  assert.equal(validateConfig({ apiBase: 'https://example.com/api/', tokenFile }).apiBase, 'https://example.com/api');
});
