---
name: aim2
description: Inspect AIM2 baskets, SERPsets, experiments, runs and crons; create or update baskets and launch existing definitions through the AIM2 MCP tools. Use for operating AIM2, not developing or deploying its source code.
---

# AIM2

Use the bundled AIM2 MCP tools. `aim2_connection` reports the installed version,
configured API and authenticated account. If configuration is missing, run the
package's `scripts/configure.mjs` with the API base URL and a local token-file path.
Credentials stay on the user's computer; never ask them to paste a key into chat.

Start with `aim2_list` and its bounded pagination. Catalogs omit large content.
Use `aim2_get` for a selected object. Basket content is paginated by the tool;
SERPset summaries and individual zero-based SERP rows are separate operations.
An empty returned page is not proof that the entire catalog is empty.
Do not infer missing scores from zero or absent fields, and do not recalculate
metrics when the user asks to inspect existing results.

For basket edits, read the current basket and all needed content pages, preserve
extra query metadata, and supply `expected_revision_id` to `aim2_save_basket`.
Saving replaces the whole query array. A 409 requires a fresh read and reconciliation.
Query `labels` must be an array of strings. Names must be nonempty.

For a requested launch, first inspect the exact experiment or cron definition.
Obtain a UUID with `aim2_request_id`, then pass it to `aim2_start`.
Keep that same UUID when reconciling an uncertain network outcome; a new UUID
can enqueue another run. Inspect the returned run or instance with `aim2_get`.
Never launch a real job merely to test connectivity. `aim2_set_cron_enabled`
requires the revision from a fresh read and reports the server's saved state.

Use write tools only when the user's request authorizes that action. Existing
authorization is sufficient; do not add redundant confirmation rounds.
When a write fails after dispatch, its outcome may be unknown: inspect state
before retrying, and do not claim success or rollback without evidence.

Plugin updates are delivered through the `aim2-plugins` marketplace. The installer
can schedule its updater. A new chat or application restart may be needed to load
updated tools. Distinguish published, installed and currently loaded versions.
