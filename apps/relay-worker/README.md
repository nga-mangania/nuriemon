# Relay Worker (Cloudflare Workers + Durable Objects)

Minimal implementation for v1 signed endpoints:
- POST /e/{event}/register-pc
- POST /e/{event}/pending-sid
- GET /healthz
 - GET /e/{event}/ws (WebSocket; join with {v:1,type:"join",sid})

Features:
- HMAC-SHA256 canonical signing (X-Relay-* headers)
- Clock skew handling (401 + X-Server-Time)
- Nonce dedupe via Durable Object storage (TTL=120s)
- Pc registration and pending SID storage
- Retry-After headers for 429/503
 - Minimal WebSocket echo with pending-sid validation

## Setup

1) Install Wrangler and login
2) Set secret EVENT_SETUP_SECRET per environment

```
# staging
yarn --version # optional
wrangler secret put EVENT_SETUP_SECRET --env=staging

# production
wrangler secret put EVENT_SETUP_SECRET
```

3) Update allowed origins in wrangler.toml if needed

## Dev & Deploy

```
# dev
yarn dev

# deploy staging
yarn deploy:stg

# deploy production
yarn deploy:prod
```

## Smoke Test

Quick health check:

```
curl -s https://<stg-domain>/healthz
```

Signed endpoints can be tested via either cURL (see REQUIREMENTS.md) or the included Node smoke test script:

Node (preferred)
```
# In apps/relay-worker
export RELAY_EVENT_SETUP_SECRET='<same value set in Worker secret>'
export EVENT_ID='demo'
export PCID='booth-01'

# Staging
npm run smoke:stg
# or, with explicit args
node ./scripts/signedSmokeTest.mjs --base=https://stg.ctrl.nuriemon.jp --event=$EVENT_ID --pcid=$PCID --ttl=90 --origin=tauri://localhost

# Production (when ready)
npm run smoke:prod
```

The script performs:
- GET /healthz
- POST /e/{event}/register-pc (with 401 clock-skew auto-resign)
- POST /e/{event}/pending-sid (then duplicate 409 check)

It prints statuses and exits non-zero on failures.

## WebSocket Test (staging)

1) Ensure a valid `sid` is registered (use the smoke test above).

2) Connect with a WS client (e.g., wscat):

```
# Install if needed: npm i -g wscat
wscat -c wss://stg.ctrl.nuriemon.jp/e/<event>/ws -H "Origin: tauri://localhost"
```

3) Send a join message:

```
{"v":1,"type":"join","sid":"<SID_FROM_PENDING>"}
```

Expected:
- `{"v":1,"type":"ack","ok":true}` then periodic `{v:1,type:"hb"}` heartbeats.
- Any other message is echoed back as `{v:1,type:"evt",echo:...}` for now.

Do not cut over custom domain until this WS flow is verified end-to-end.
