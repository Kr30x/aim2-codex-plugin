import { readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface Config { apiBase: string; tokenFile: string; allowInsecureHttp?: boolean }
export function configPath(): string {
  return process.env.AIM2_CONFIG ?? join(homedir(), '.config', 'aim2-codex', 'config.json');
}
export function validateConfig(value: unknown): Config {
  if (!value || typeof value !== 'object') throw new Error('Invalid AIM2 configuration.');
  const c = value as Config;
  if (typeof c.apiBase !== 'string' || typeof c.tokenFile !== 'string' || !c.tokenFile.startsWith('/'))
    throw new Error('Set apiBase and an absolute tokenFile path with configure.mjs.');
  const u = new URL(c.apiBase);
  if (u.username || u.password || u.search || u.hash) throw new Error('API URL cannot contain credentials, query or fragment.');
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && (loopback || c.allowInsecureHttp === true)))
    throw new Error('Use HTTPS, or explicitly allow HTTP for this deployment.');
  return { ...c, apiBase: c.apiBase.replace(/\/+$/, '') };
}
export function loadConfig(): Config {
  try { return validateConfig(JSON.parse(readFileSync(configPath(), 'utf8'))); }
  catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') throw new Error('AIM2 is not configured. Run scripts/configure.mjs --help.');
    throw e;
  }
}
export class Aim2Client {
  constructor(readonly config: Config) { validateConfig(config); }
  async request(path: string, method = 'GET', data?: unknown, query: Record<string, unknown> = {}): Promise<any> {
    if (!/^\/[a-z0-9/-]+$/.test(path)) throw new Error('Invalid API path.');
    if (process.platform !== 'win32' && (statSync(this.config.tokenFile).mode & 0o077))
      throw new Error('Token file permissions must be 0600.');
    const token = readFileSync(this.config.tokenFile, 'utf8').trim();
    if (!token || /\s/.test(token)) throw new Error('Token file must contain one API key.');
    const url = new URL(this.config.apiBase + path);
    for (const [k, v] of Object.entries(query)) if (v !== undefined) url.searchParams.set(k, String(v));
    let response: Response;
    try {
      response = await fetch(url, {
        method, redirect: 'error', signal: AbortSignal.timeout(30_000),
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...(data === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(data === undefined ? {} : { body: JSON.stringify(data) }),
      });
    } catch {
      throw new Error(method === 'GET' ? 'AIM2 request failed (network, redirect or timeout).' : 'AIM2 write outcome is unknown. Read back before retrying; reuse the same launch request_id.');
    }
    if (!response.ok) {
      await response.body?.cancel();
      const hint: Record<number, string> = { 401: 'Check your API key.', 403: 'Account has insufficient permissions.', 404: 'Object or API operation not found.', 409: 'Conflict: read current state before retrying.', 410: 'Content has expired.', 422: 'Payload does not match this server version.' };
      throw new Error(`AIM2 HTTP ${response.status}. ${hint[response.status] ?? 'Server rejected the request; inspect state before retrying a write.'}`);
    }
    if (response.status === 204) return null;
    if (!response.headers.get('content-type')?.includes('application/json')) { await response.body?.cancel(); throw new Error('Expected JSON. Check the API base URL.'); }
    const chunks: Uint8Array[] = []; let size = 0;
    if (!response.body) throw new Error('Empty API response.');
    for await (const chunk of response.body) {
      size += chunk.byteLength;
      if (size > 16 * 1024 * 1024) throw new Error('Response exceeds 16 MiB. Use a catalog or individual SERP.');
      chunks.push(chunk);
    }
    const body = Buffer.concat(chunks).toString('utf8').split(token).join('[REDACTED]');
    try { return JSON.parse(body); } catch { throw new Error('Invalid JSON from AIM2.'); }
  }
}
