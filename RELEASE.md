# 社内配布・検証用メモ

## 1) distウォッチ + 本番同等オリジン

```
npm run dev:dist
npm run tauri dev
```

WebView のオリジンが `tauri://localhost` になるため、CORS で Relay に弾かれません。

## 2) パッケージビルド（未署名）

```
npm run tauri build
```

macOS では Gatekeeper によりブロックされる可能性があるため、初回は「右クリック→開く」で回避してください。

## 3) 固定 eventId ビルド（社内テスト）

`src-tauri/resources/global_settings.studio.json` を `global_settings.json` として同梱した派生ビルドを作る場合は、`src-tauri/tauri.conf.json` の `bundle.resources` を一時的に入れ替えて利用してください。

例: `resources/global_settings.json` → `global_settings.studio.json` をコピーした上でビルド。

## 4) Relay tail（staging）

```
cd apps/relay-worker
wrangler tail --env=staging
```

`pc-auth ok` → `join received` → `fwd cmd` の流れと、`pc-offline/pc-online` のイベントを確認。

## 5) ライセンス（stg）通しテスト

```
cd apps/license-api
wrangler d1 execute nuriemon-license-stg --file=./schema.sql --env=staging
wrangler secret put SIGNING_JWK --env=staging   # JWK 形式
wrangler deploy --env=staging

# 発行
curl -X POST -H "Content-Type: application/json" -H "X-Admin-Api-Key: $ADMIN" \
  -d '{"sku":"NRM-STD","seats":2}' https://license.stg.nuriemon.jp/license/issue
```

アプリ側: 設定 → EventID 入力 → ライセンスコードを入力して「有効化」。以後は Authorization ヘッダ/WS サブプロトコルで自動付与されます。

## 6) 既知の注意点

- 初回モデルDLが走る環境では数十秒かかる場合があります。以降はオフラインで動作します。
- HMR（http://localhost:1420）は CORS 差異があるため基本は使用しません。
