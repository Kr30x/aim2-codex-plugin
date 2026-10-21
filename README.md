# AIM2 for Codex

A standalone plugin for the AIM2 API. Each user supplies their own API URL and
key. No AIM2 checkout, shared ChatGPT workspace or server-side installation is
required. The package includes its MCP server and JavaScript dependencies.

## Install

Requires Codex desktop or CLI, Git and Node.js 22+. macOS and Linux are supported.

```sh
git clone --branch stable https://github.com/Kr30x/aim2-codex-plugin.git
cd aim2-codex-plugin
node scripts/manage.mjs install
```

Installation enables an hourly update job (`launchd` on macOS, a user systemd
timer on Linux). Use `install --no-auto-update` to install without scheduling.
Updates track the `stable` release branch, not development commits on `main`.
Start a new chat after installation; restart the app if tools remain stale.

Save your account's AIM2 API key in a local file with mode 0600, then configure:

```sh
node scripts/configure.mjs --api-base https://your-server.example/api --token-file /absolute/path/to/key
```

The API base includes the deployment's prefix, if any. Configuration lives at
`~/.config/aim2-codex/config.json`; `AIM2_CONFIG` can override it. The plugin reads
the key from the supplied file and never embeds it in a release. Remote HTTP
requires explicit `--allow-http`; prefer HTTPS. A key has the account's permissions.

Ask Codex: “Use AIM2 to check my connection and show the basket catalog.”

## Available tools

- `aim2_connection`: installed server version and current account.
- `aim2_list`: compact catalogs and paginated run history.
- `aim2_get`: basket pages, definitions, instances, cron runs, SERPset summaries and individual SERPs.
- `aim2_save_basket`: create or replace a basket, with revision protection and read-back.
- `aim2_request_id` and `aim2_start`: deduplicated launches of existing definitions.
- `aim2_set_cron_enabled`: change enabled state with revision protection.

Writes run with your API account and only when you request them. This release
does not implement arbitrary HTTP calls, deletion or metric recalculation.

```sh
node scripts/manage.mjs update
node scripts/manage.mjs status
node scripts/manage.mjs disable-auto-update
```

Set `AIM2_CODEX_BIN` if the installer cannot find Codex. Update receipts and logs
are under `~/.local/share/aim2-codex/`. Updates do not modify API configuration,
keys or running chats. `disable-auto-update` retains the plugin and credentials.
To uninstall the plugin: `codex plugin remove aim2@aim2-plugins`.

## Develop and release

```sh
npm ci
npm run check
```

Source is TypeScript. `npm run build` produces the standalone
`plugins/aim2/server/index.cjs`; commit the generated bundle with its source.
Increment `package.json`, the lockfile and `plugins/aim2/.codex-plugin/plugin.json` together.
The release workflow validates a `vX.Y.Z` tag, checks that its bundle is
reproducible, creates a ZIP and checksum, publishes a GitHub Release and advances
`stable` only after validation. Never commit deployment configuration or API data.

The plugin's API tests use a local synthetic server. A real connection check
should only read the account and a small catalog page, without launching work.
