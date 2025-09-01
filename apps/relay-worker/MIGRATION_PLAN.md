# Production Migration Plan (Durable Objects / Free Plan Compatibility)

This document describes safe paths to prepare production without breaking existing deployments. Do NOT cut over the custom domain until `/session` → WebSocket is implemented and verified.

## Current State
- Staging (`env.staging`) uses `[[env.staging.migrations]] tag="stg-v1" new_sqlite_classes=["EventDO"]` → OK on Free plan.
- Default (production) currently has `[[migrations]] tag="v1" new_sqlite_classes=["EventDO"]` in repo. If production has never been deployed, this is fine. If production was deployed in the past with `new_classes`, we must not change history.

## Determine Production History
1. Check if production has existing migration tag(s):
   - `wrangler deployments list` (or Cloudflare dashboard → Workers → `nuriemon-relay` → Migrations)
2. Cases:
   - Case A: No previous prod deployment ⇒ keep `v1 new_sqlite_classes` as is, deploy.
   - Case B: Previously deployed with `v1 new_classes=["EventDO"]` ⇒ you must reflect that in `wrangler.toml` and append a new migration.

## Case B: Append v2 Migration
If production previously used the legacy `new_classes`, edit the default migrations to exactly match history, then append a v2 migration to create SQLite-backed namespaces as required by the Free plan for new namespaces.

Example (default/production only):
```
[[migrations]]
tag = "v1"
new_classes = ["EventDO"]

[[migrations]]
tag = "v2"
new_sqlite_classes = ["EventDO"]
```

Notes:
- Do not modify an already-applied tag’s content; only append a new tag.
- Staging config stays as-is (`stg-v1` with `new_sqlite_classes`).
- Deploy production only after `/session` WS is implemented and staging-tested.

## CORS (Production)
`ALLOWED_ORIGINS` now includes `tauri://localhost` in addition to `https://ctrl.nuriemon.jp` to support desktop app fetches.

## Deployment Steps (When Ready)
1. Update `wrangler.toml` default migrations to reflect actual prod history (Case A or B above).
2. `wrangler deploy` (default env = production). Do not switch custom domain yet.
3. Implement `/session` WebSocket and verify on staging.
4. After WS passes smoke and E2E, cut over custom domain.

