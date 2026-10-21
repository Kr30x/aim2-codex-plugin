import { mkdirSync, writeFileSync, renameSync, statSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
const args = process.argv.slice(2);
if (args.includes('--help') || !args.length) {
  console.log('node configure.mjs --api-base https://your-server.example/api --token-file /absolute/path/to/key [--allow-http]');
  process.exit(0);
}
const option = key => { const i = args.indexOf(key); return i < 0 ? undefined : args[i + 1]; };
const apiBase = option('--api-base'); const tokenPath = option('--token-file');
if (!apiBase || !tokenPath) throw new Error('--api-base and --token-file are required.');
const u = new URL(apiBase);
if (u.username || u.password || u.search || u.hash) throw new Error('Do not put credentials or query parameters in the URL.');
const insecure = u.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
if (!['http:', 'https:'].includes(u.protocol) || (insecure && !args.includes('--allow-http'))) throw new Error('Use HTTPS or explicitly pass --allow-http for this server.');
const tokenFile = resolve(tokenPath);
if ((statSync(tokenFile).mode & 0o077) !== 0) throw new Error('Restrict the token file to mode 0600 first.');
if (!readFileSync(tokenFile, 'utf8').trim()) throw new Error('Token file is empty.');
const path = process.env.AIM2_CONFIG ?? join(homedir(), '.config', 'aim2-codex', 'config.json');
mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
const temp = path + `.tmp-${process.pid}`;
writeFileSync(temp, JSON.stringify({ apiBase: apiBase.replace(/\/+$/, ''), tokenFile, ...(insecure ? { allowInsecureHttp: true } : {}) }, null, 2) + '\n', { mode: 0o600 });
renameSync(temp, path);
console.log(`AIM2 configuration saved: ${path}. The API key was not copied.`);
