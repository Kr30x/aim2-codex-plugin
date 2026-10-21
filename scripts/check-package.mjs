import { readFileSync, readdirSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
const root = 'plugins/aim2';
const forbidden = [/-----BEGIN .*PRIVATE KEY/, /(?:yandex-team\.ru|yandex\.net)/i, /\/Users\//, /\/home\/[a-z][a-z0-9_-]*\//i, /gAAAAA[A-Za-z0-9_-]{40,}/, /github_pat_[A-Za-z0-9_]+/, /gh[pousr]_[A-Za-z0-9]+/];
let count = 0;
function scan(dir) {
  for (const name of readdirSync(dir)) {
    const file = join(dir, name); const stat = lstatSync(file);
    if (stat.isSymbolicLink()) throw new Error(`Symlink not allowed: ${file}`);
    if (stat.isDirectory()) { scan(file); continue; }
    if (/(^\.env|\.log$|token|config\.json$|\.map$)/.test(name)) throw new Error(`Local artifact in package: ${file}`);
    const text = readFileSync(file, 'utf8');
    if (forbidden.some(re => re.test(text))) throw new Error(`Private data pattern in ${file}`);
    count++;
  }
}
scan(root);
const p = JSON.parse(readFileSync(`${root}/plugin.json`));
if (!/^\d+\.\d+\.\d+$/.test(p.version)) throw new Error('Expected a release version.');
console.log(`Package checked: ${p.name} ${p.version}, ${count} files; no deployment addresses, local credentials or private paths.`);
