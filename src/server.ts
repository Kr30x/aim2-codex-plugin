import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { Aim2Client, loadConfig } from './client.js';

declare const PLUGIN_VERSION: string;
const server = new McpServer({ name: 'aim2', version: PLUGIN_VERSION });
const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const paging = { limit: z.number().int().min(1).max(100).default(25), offset: z.number().int().min(0).default(0) };
const read = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };
const write = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true };
const client = (): Aim2Client => new Aim2Client(loadConfig());
function result(data: unknown) {
  const text = JSON.stringify(data);
  if (text.length > 750_000) throw new Error('Tool result is too large. Request a smaller page or object.');
  return { content: [{ type: 'text' as const, text }] };
}
function safe(fn: (args: any) => Promise<unknown>) {
  return async (args: any) => {
    try { return result(await fn(args)); }
    catch (e) { return { isError: true, content: [{ type: 'text' as const, text: e instanceof Error ? e.message : 'AIM2 request failed.' }] }; }
  };
}
server.registerTool('aim2_connection', { description: 'Check plugin version and authenticated AIM2 account; does not reveal credentials.', inputSchema: {}, annotations: read }, safe(async () => {
  const c = client(); return { version: PLUGIN_VERSION, apiBase: c.config.apiBase, user: await c.request('/auth/me') };
}));
server.registerTool('aim2_request_id', { description: 'Generate a UUID for one requested launch. Reuse it on retries to avoid duplicate jobs.', inputSchema: {}, annotations: read }, safe(async () => ({ request_id: randomUUID() })));
server.registerTool('aim2_list', {
  description: 'Read a bounded AIM2 catalog or run history. Baskets and SERPsets use compact catalogs. Pass parent_id for experiment_instances or cron_runs.',
  inputSchema: { kind: z.enum(['baskets', 'serpsets', 'experiments', 'crons', 'metrics', 'aspects', 'enrichments', 'experiment_instances', 'cron_runs']), ...paging, parent_id: id.optional(), q: z.string().max(200).optional() }, annotations: read,
}, safe(async (a) => {
  const paths: Record<string, string> = { baskets: '/baskets/catalog', serpsets: '/serpsets/catalog', experiments: '/experiments', crons: '/crons', metrics: '/metrics', aspects: '/aspects', enrichments: '/enrichments' };
  if (['experiment_instances', 'cron_runs'].includes(a.kind) && !a.parent_id) throw new Error('parent_id is required for this history.');
  const path = a.kind === 'experiment_instances' ? `/experiments/${a.parent_id}/instances` : a.kind === 'cron_runs' ? `/crons/${a.parent_id}/runs` : paths[a.kind];
  if (a.q && !['experiments', 'crons'].includes(a.kind)) throw new Error('q is supported only for experiments and crons. Page the other catalogs.');
  const items = await client().request(path, 'GET', undefined, { limit: a.limit, offset: a.offset, q: a.q });
  return { items, limit: a.limit, offset: a.offset, next_offset: Array.isArray(items) && items.length === a.limit ? a.offset + a.limit : null };
}));
server.registerTool('aim2_get', {
  description: 'Read one basket, experiment, instance, cron, cron run, SERPset summary, or zero-based SERP. Basket content uses offset/limit. cron_run needs parent_id.',
  inputSchema: { kind: z.enum(['basket', 'experiment', 'instance', 'cron', 'cron_run', 'serpset_summary', 'serp']), id, parent_id: id.optional(), index: z.number().int().min(0).optional(), ...paging }, annotations: read,
}, safe(async (a) => {
  const c = client();
  if (a.kind === 'serpset_summary') {
    const rows = await c.request('/serpsets/catalog', 'GET', undefined, { serpset_id: a.id, limit: 100 });
    const row = rows.find((r: any) => r.id === a.id);
    if (!row) throw new Error('SERPset not found in the catalog response; this server may not support exact-ID catalog lookup.');
    return row;
  }
  if (a.kind === 'serp' && a.index === undefined) throw new Error('index is required for an individual SERP.');
  if (a.kind === 'cron_run' && !a.parent_id) throw new Error('parent_id (cron ID) is required.');
  const paths: Record<string, string> = { basket: `/baskets/${a.id}`, experiment: `/experiments/${a.id}`, instance: `/experiment-instances/${a.id}`, cron: `/crons/${a.id}`, cron_run: `/crons/${a.parent_id}/runs/${a.id}`, serp: `/serpsets/${a.id}/serps/${a.index}` };
  const data = await c.request(paths[a.kind]);
  if (a.kind === 'basket') { const content = data.content ?? []; return { ...data, content: content.slice(a.offset, a.offset + a.limit), content_total: content.length, content_offset: a.offset, next_offset: a.offset + a.limit < content.length ? a.offset + a.limit : null }; }
  return data;
}));
const query = z.object({ text: z.string(), labels: z.array(z.string()).optional() }).passthrough();
server.registerTool('aim2_save_basket', {
  description: 'Create a basket or replace its complete query array and name. For updates read all pages first, preserve metadata and supply expected_revision_id. No automatic retries.',
  inputSchema: { id: id.optional(), expected_revision_id: id.optional(), name: z.string().trim().min(1).max(255), content: z.array(query).max(10_000) }, annotations: { ...write, destructiveHint: true },
}, safe(async (a) => {
  if (a.id && !a.expected_revision_id) throw new Error('Updates require expected_revision_id from a fresh read.');
  if (!a.id && a.expected_revision_id) throw new Error('A new basket has no expected_revision_id.');
  const c = client();
  const saved = await c.request(a.id ? `/baskets/${a.id}` : '/baskets', a.id ? 'PUT' : 'POST', { name: a.name, content: a.content, ...(a.id ? { expected_revision_id: a.expected_revision_id } : {}) });
  try {
    const current = await c.request(`/baskets/${saved.id}`);
    return { id: saved.id, revision_id: saved.revision_id, name: saved.name, query_count: saved.content?.length, read_back_verified: current.revision_id === saved.revision_id && current.name === saved.name && JSON.stringify(current.content) === JSON.stringify(saved.content) };
  } catch { return { id: saved.id, revision_id: saved.revision_id, write_succeeded: true, read_back_verified: false }; }
}));
server.registerTool('aim2_start', {
  description: 'Launch an existing experiment or manually instantiate a cron, only when requested. Read the definition first. Use one UUID per intended run; reuse on retries.',
  inputSchema: { kind: z.enum(['experiment', 'cron']), id, request_id: z.string().uuid() }, annotations: { ...write, idempotentHint: true },
}, safe(async (a) => client().request(a.kind === 'experiment' ? `/experiments/${a.id}/instances` : `/crons/${a.id}/instantiate`, 'POST', { request_id: a.request_id })));
server.registerTool('aim2_set_cron_enabled', {
  description: 'Enable or disable an existing cron with optimistic revision protection. Read the cron first. Does not itself launch a run.',
  inputSchema: { id, enabled: z.boolean(), expected_revision: id }, annotations: { ...write, destructiveHint: true },
}, safe(async (a) => {
  const c = client(); const saved = await c.request(`/crons/${a.id}/enabled`, 'PATCH', { enabled: a.enabled, expected_revision: a.expected_revision });
  try { const current = await c.request(`/crons/${a.id}`); return { saved, read_back_verified: current.enabled === a.enabled && current.revision === saved.revision }; }
  catch { return { saved, write_succeeded: true, read_back_verified: false }; }
}));
server.connect(new StdioServerTransport()).catch(() => { process.stderr.write('AIM2 MCP failed to start.\n'); process.exitCode = 1; });
