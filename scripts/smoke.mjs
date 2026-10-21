import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { resolve, join } from 'node:path';
const pluginRoot = resolve(process.argv[2] ?? 'plugins/aim2');
const client = new Client({ name: 'aim2-smoke', version: '1.0.0' });
const transport = new StdioClientTransport({ command: '/bin/sh', args: [join(pluginRoot, 'scripts/launch.sh')], env: { ...process.env }, stderr: 'pipe' });
try {
  await client.connect(transport);
  const names = (await client.listTools()).tools.map(t => t.name);
  async function call(name, args = {}) {
    const result = await client.callTool({ name, arguments: args });
    if (result.isError) throw new Error(result.content[0].text);
    return JSON.parse(result.content[0].text);
  }
  const connection = await call('aim2_connection');
  console.log(JSON.stringify({ version: connection.version, authenticated: Boolean(connection.user), tools: names }));
  for (const kind of ['baskets', 'serpsets', 'experiments', 'crons', 'metrics', 'aspects', 'enrichments']) {
    const result = await call('aim2_list', { kind, limit: 2 });
    console.log(JSON.stringify({ kind, returned: result.items.length, next_offset: result.next_offset }));
  }
} finally { await client.close(); }
