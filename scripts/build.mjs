import { build } from 'esbuild';
import { readFileSync, mkdirSync } from 'node:fs';
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));
const manifest = JSON.parse(readFileSync(new URL('../plugins/aim2/plugin.json', import.meta.url)));
if (manifest.version !== pkg.version) throw new Error('Package and plugin versions differ.');
mkdirSync('plugins/aim2/server', { recursive: true });
await build({ entryPoints: ['src/server.ts'], outfile: 'plugins/aim2/server/index.cjs', bundle: true, platform: 'node', target: 'node22', format: 'cjs', minify: true, legalComments: 'eof', define: { PLUGIN_VERSION: JSON.stringify(pkg.version) } });
await build({ entryPoints: ['src/client.ts'], outfile: 'dist/client.mjs', bundle: true, platform: 'node', target: 'node22', format: 'esm' });
