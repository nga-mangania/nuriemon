# 運用手順（ライセンス / Relay）

## Cloudflare 準備

- DNS: `license.nuriemon.jp`（prod）, `license.stg.nuriemon.jp`（stg）
- Workers: `nuriemon-license-api`（prod）, `nuriemon-license-api-stg`（stg）
- D1: `nuriemon-license`（prod）, `nuriemon-license-stg`（stg）

## license-api デプロイ

```
cd apps/license-api
# 1) D1 にスキーマ適用
wrangler d1 execute nuriemon-license-stg --file=./schema.sql --env=staging

# 2) 秘密鍵（JWK）と公開鍵（JWKS）を登録（推奨）
wrangler secret put SIGNING_JWK --env=staging         # 署名用（private JWK）
wrangler secret put SIGNING_PUBLIC_JWKS --env=staging  # 配信用の公開JWKS（keys: [...]）

# 3) （任意）管理APIキー
wrangler secret put ADMIN_API_KEY --env=staging

# 4) デプロイ
wrangler deploy --env=staging
```

`/.well-known/jwks.json` は、まず `SIGNING_PUBLIC_JWKS` をそのまま返します（推奨）。未設定の場合のみ、`SIGNING_JWK` に含まれる公開要素（Ed25519なら `x`、RSAなら `n/e`）からJWKSを組み立てます。鍵の export は行いません。

## relay-worker の設定

`apps/relay-worker/wrangler.toml` の `LICENSE_JWKS_URL`/`LICENSE_ISSUER`/`LICENSE_AUDIENCE` を stg/prod で設定し、デプロイ。

```
cd apps/relay-worker
wrangler deploy --env=staging
```

## 管理API（発行/失効）

```
# 発行（stg）
curl -X POST \
  -H "Content-Type: application/json" \
  -H "X-Admin-Api-Key: $ADMIN" \
  -d '{"sku":"NRM-STD","seats":2,"expiresAt":null}' \
  https://license.stg.nuriemon.jp/license/issue

# 失効
curl -X POST -H "X-Admin-Api-Key: $ADMIN" -d '{"code":"ABCD..."}' https://license.stg.nuriemon.jp/license/revoke
```

## 通し検証（stg）

1. `license-api` でライセンス発行 → コード控える
2. アプリ起動 → 設定 → EventID 入力 → ライセンスコードを入力し「有効化」
3. 「スクリーンを表示」→ QR からスマホ接続 → コマンドが反映されること
4. `wrangler tail --env=staging`（relay）で `pc-auth ok`/`join`/`cmd` を確認

## キー更新（ローテーション）

- 新しい `SIGNING_JWK` を設定（`kid` を新規値に）。
- `/.well-known/jwks.json` は自動で新 `kid` を含む公開鍵に更新。
- 既存トークンは旧 `kid` で検証され続けるため、失効は TTL 経過で自然切替。必要に応じて `/token/refresh` を促す。
