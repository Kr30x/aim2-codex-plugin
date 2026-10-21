import { spawnSync } from 'node:child_process';
import { existsSync, realpathSync, mkdirSync, writeFileSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = 'https://github.com/Kr30x/aim2-codex-plugin.git';
const marketplace = 'aim2-plugins';
const selector = 'aim2@aim2-plugins';
const root = process.env.AIM2_UPDATER_DATA_DIR ?? join(homedir(), '.local', 'share', 'aim2-codex');
const label = 'com.aim2.codex-plugin-updater';
const plist = join(homedir(), 'Library', 'LaunchAgents', label + '.plist');
const unit = join(homedir(), '.config', 'systemd', 'user', 'aim2-codex-update');
function run(command, args, quiet = false) {
  const r = spawnSync(command, args, { encoding: 'utf8', timeout: 120_000, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, PATH: `${dirname(process.execPath)}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:${process.env.PATH ?? ''}` } });
  if (r.error || r.status !== 0) throw new Error(`${command.split('/').at(-1)} ${args.slice(0, 3).join(' ')} failed: ${(r.stderr || r.error?.message || 'unknown error').slice(0, 1800)}`);
  if (!quiet && r.stdout.trim()) console.log(r.stdout.trim());
  return r.stdout;
}
function codex() {
  const candidates = [process.env.AIM2_CODEX_BIN, join(homedir(), '.local', 'bin', 'codex'), '/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex', '/Applications/Codex.app/Contents/Resources/codex', '/opt/homebrew/bin/codex', '/usr/local/bin/codex'];
  for (const c of candidates) if (c && existsSync(c)) return c;
  const r = spawnSync('which', ['codex'], { encoding: 'utf8' });
  if (r.status === 0) return r.stdout.trim();
  throw new Error('Codex CLI not found. Set AIM2_CODEX_BIN to its executable.');
}
function atomic(path, text, mode = 0o600) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = path + `.tmp-${process.pid}`; writeFileSync(tmp, text, { mode }); renameSync(tmp, path);
}
function updaterCopy() {
  const target = join(root, 'updater.mjs');
  const source = fileURLToPath(import.meta.url);
  if (source !== target) atomic(target, readFileSync(source, 'utf8'));
  return target;
}
function nodeExecutable() {
  // Keep a stable package-manager symlink when it resolves to this runtime.
  for (const candidate of ['/opt/homebrew/bin/node', '/usr/local/bin/node', '/usr/bin/node']) {
    try { if (realpathSync(candidate) === realpathSync(process.execPath)) return candidate; } catch {}
  }
  return process.execPath;
}
function refreshUpdater(current) {
  const source = current.source?.path;
  if (!source) return;
  const manifest = JSON.parse(readFileSync(join(source, '.codex-plugin', 'plugin.json'), 'utf8'));
  if (manifest.name !== 'aim2' || manifest.version !== current.version) throw new Error('Updated package identity mismatch.');
  atomic(join(root, 'updater.mjs'), readFileSync(join(source, 'scripts', 'manage.mjs'), 'utf8'));
}
function schedule(bin) {
  const updater = updaterCopy();
  const escape = s => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);
  if (process.platform === 'darwin') {
    const xml = `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>Label</key><string>${label}</string><key>ProgramArguments</key><array><string>${escape(nodeExecutable())}</string><string>${escape(updater)}</string><string>update</string></array><key>EnvironmentVariables</key><dict><key>AIM2_CODEX_BIN</key><string>${escape(bin)}</string></dict><key>StartInterval</key><integer>3600</integer><key>RunAtLoad</key><true/><key>StandardOutPath</key><string>${escape(join(root, 'updater.log'))}</string><key>StandardErrorPath</key><string>${escape(join(root, 'updater-error.log'))}</string></dict></plist>\n`;
    atomic(plist, xml);
    spawnSync('launchctl', ['bootout', `gui/${process.getuid()}/${label}`], { encoding: 'utf8' });
    run('launchctl', ['bootstrap', `gui/${process.getuid()}`, plist], true);
  } else if (process.platform === 'linux') {
    const quote = s => '"' + s.replace(/[%\\"]/g, c => c === '%' ? '%%' : '\\' + c) + '"';
    atomic(unit + '.service', `[Unit]\nDescription=Update AIM2 Codex plugin\n[Service]\nType=oneshot\nEnvironment=${quote('AIM2_CODEX_BIN=' + bin)}\nExecStart=${quote(nodeExecutable())} ${quote(updater)} update\n`, 0o600);
    atomic(unit + '.timer', '[Unit]\nDescription=Hourly AIM2 plugin updates\n[Timer]\nOnBootSec=5m\nOnUnitActiveSec=1h\nPersistent=true\n[Install]\nWantedBy=timers.target\n');
    run('systemctl', ['--user', 'daemon-reload'], true); run('systemctl', ['--user', 'enable', '--now', 'aim2-codex-update.timer'], true);
  } else throw new Error('Automatic scheduling supports macOS and Linux. Use update manually on other platforms.');
}
const action = process.argv[2];
try {
  if (!action || action === '--help') {
    console.log('Commands: install [--no-auto-update], update, status, disable-auto-update. Configure AIM2 separately with configure.mjs.');
  } else if (action === 'install') {
    const bin = codex();
    run(bin, ['plugin', 'marketplace', 'add', repo, '--ref', 'stable', '--json']);
    run(bin, ['plugin', 'add', selector, '--json']);
    if (!process.argv.includes('--no-auto-update')) schedule(bin);
    console.log('Installed AIM2. Configure your API connection, then start a new Codex chat.');
  } else if (action === 'update') {
    mkdirSync(root, { recursive: true, mode: 0o700 });
    const lock = join(root, 'update.lock');
    try { mkdirSync(lock); } catch (e) { if (e.code === 'EEXIST') {
      let previous;
      try { previous = Number(readFileSync(join(lock, 'pid'), 'utf8')); } catch { console.log('Updater is already starting.'); process.exit(0); }
      if (!Number.isSafeInteger(previous) || previous < 1) throw new Error('Invalid updater lock; inspect update.lock manually.');
      try { process.kill(previous, 0); console.log('Updater is already running.'); process.exit(0); }
      catch (probe) { if (probe.code !== 'ESRCH') throw probe; }
      rmSync(lock, { recursive: true }); mkdirSync(lock);
    } else throw e; }
    writeFileSync(join(lock, 'pid'), String(process.pid), { mode: 0o600 });
    try {
      const bin = codex();
      const before = JSON.parse(run(bin, ['plugin', 'list', '--marketplace', marketplace, '--json'], true));
      const previous = before.installed?.find(p => p.pluginId === selector);
      if (!previous) throw new Error('AIM2 was uninstalled; refusing to reinstall it automatically.');
      const refresh = JSON.parse(run(bin, ['plugin', 'marketplace', 'upgrade', marketplace, '--json'], true));
      if (refresh.errors?.length) throw new Error('Marketplace upgrade reported errors; retry update after checking Codex.');
      // Refresh configured plugins without reinstalling: reinstalling could re-enable a user-disabled plugin.
      const after = JSON.parse(run(bin, ['plugin', 'list', '--marketplace', marketplace, '--json'], true));
      const current = after.installed?.find(p => p.pluginId === selector);
      if (!current) throw new Error('Marketplace refreshed but installed plugin could not be verified.');
      if (previous.enabled !== current.enabled) throw new Error('Unexpected plugin enabled-state change; inspect Codex settings.');
      refreshUpdater(current);
      atomic(join(root, 'last-update.json'), JSON.stringify({ checkedAt: new Date().toISOString(), previousVersion: previous.version, installedVersion: current.version, enabled: current.enabled, refresh }, null, 2) + '\n');
      console.log(`AIM2 ${previous.version} -> ${current.version}; enabled=${current.enabled}. New chats load the installed version.`);
    } finally { rmSync(lock, { recursive: true }); }
  } else if (action === 'status') {
    run(codex(), ['plugin', 'list', '--marketplace', marketplace, '--json']);
    const receipt = join(root, 'last-update.json'); if (existsSync(receipt)) console.log(readFileSync(receipt, 'utf8'));
  } else if (action === 'disable-auto-update') {
    if (process.platform === 'darwin') { spawnSync('launchctl', ['bootout', `gui/${process.getuid()}/${label}`], { encoding: 'utf8' }); rmSync(plist, { force: true }); }
    else if (process.platform === 'linux') { run('systemctl', ['--user', 'disable', '--now', 'aim2-codex-update.timer'], true); rmSync(unit + '.timer', { force: true }); rmSync(unit + '.service', { force: true }); run('systemctl', ['--user', 'daemon-reload'], true); }
    console.log('Automatic updates disabled. Plugin and credentials retained.');
  } else throw new Error('Unknown command. Use --help.');
} catch (e) { console.error(e.message); process.exitCode = 1; }
