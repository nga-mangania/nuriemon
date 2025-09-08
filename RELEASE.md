# リリース手順（配布用ビルド）

この文書は配布ビルドを作る人向けの簡潔な手順書です。開発機での挙動と配布時の挙動差（Relay設定の表示、ライセンス必須化など）も明記します。

## 用語と前提

- 有効設定（effective）: 以下の優先順位で決定される設定。上ほど強い
  1) 環境変数 `NURIEMON_GLOBAL_SETTINGS_PATH`（JSONファイルパス）
  2) ユーザー設定ファイル（macOS: `~/Library/Application Support/nuriemon/global_settings.json`）
  3) バンドル同梱 `src-tauri/resources/global_settings.json`
  4) アプリ内部保存値（GlobalSettingsService）
  5) 個別キーENV上書き（`NURIEMON_RELAY_BASE_URL` など）
- UIの表示/ロックは有効設定の `ui.hideRelaySettings` / `ui.lockRelaySettings` によって決まる（PC個体やビルド種別には依存しない）
- ライセンス必須化は `license.activationRequired` で決まる（false なら未有効化でも利用可）

## 配布プロファイル（どちらかを同梱）

1) 一般配布（購入者用）
- 同梱ファイル: `src-tauri/resources/global_settings.json`
- 推奨値:
  - `relay.baseUrl`: `https://ctrl.nuriemon.jp`
  - `relay.eventId`: 空（初回セットアップで購入者が入力）
  - `defaults.operationMode`: `relay`
  - `license.endpoint`: `https://license.nuriemon.jp`
  - `license.activationRequired`: `true`（ライセンス必須）
  - `ui.hideRelaySettings`: `true`（Relay詳細は非表示）
  - `ui.lockRelaySettings`: `true`（ユーザー編集不可）

→ この設定だと、設定画面には「Event ID 入力」だけが表示され、Relayの接続先やPCIDなどは表示/編集されません。

2) 社内/スタジオ配布（固定イベント・検証用）
- サンプル: `src-tauri/resources/global_settings.studio.json`
- 特徴: 事前に `relay.eventId` を固定し、`ui.hideRelaySettings: true` / `ui.lockRelaySettings: true` で本番相当の表示にする。`license.activationRequired` は運用方針に応じて切替。
- 使い方: スタジオ配布にしたい場合は、ビルド前に `global_settings.studio.json` の内容を `global_settings.json` に反映してビルドする。

補足: ユーザー環境のユーザー設定ファイル（優先度2）が存在すると、同梱値より強く上書きされます。想定と違う表示/挙動の場合は、まず有効設定を確認してください。

## ビルド手順

1) 本番同等のオリジンで開発（CORS回避）
- `npm run dev:dist`（Viteが `dist/` を監視）
- 別ターミナルで `npm run tauri dev`
→ WebViewのオリジンが `tauri://localhost` になり、RelayのCORSを回避できます。

2) パッケージビルド（未署名）
- `npm run tauri build`
- macOS 初回は「右クリック→開く」でGatekeeperを回避。

Intel Mac / Universal / Windows 用の作り方

A) Apple Silicon（arm64）
npm run tauri build

B) Intel Mac（x86_64）
rustup target add x86_64-apple-darwin
npm run tauri build -- --target x86_64-apple-darwin

C) Universal（arm64 + x86_64）
npm run tauri build -- --target universal-apple-darwin


3) 起動できない場合のよくある対処
- rollupのoptional dependencyエラー: `rm -rf node_modules package-lock.json && npm i`
- Updater: 現状は無効化済み（pubkey未設定でのクラッシュを防止）。Updaterを使う場合は公開鍵/エンドポイントを準備のうえ有効化。

## Relay / ライセンスの挙動（重要）

- 本番 eventId（例: `school-2025-*` 等）
  - Relay は JWT（デバイストークン）での認証を前提。
  - アプリ側は「ライセンス有効化 → deviceTokenをキーチェーン保存」後、HTTPは `Authorization: Bearer`、WSは `Sec-WebSocket-Protocol: bearer.<token>, v1` を自動付与。
- 例外（HMAC 経路）
  - `eventId` が `^demo` または `^studio-` の場合のみ、HMAC経路を限定許可（社内/検証用）。
  - それ以外のeventIdでは HMAC は拒否され、JWTが必須です。
- Local モード
  - Relayを使わないローカル接続。ライセンス必須化はアプリの `license.activationRequired` に依存（falseなら未有効化でもUIが進む）。

## 有効設定の確認とトラブルシュート

- 設定画面の「有効設定（effective）を表示」で現在有効なJSONを確認できます。
- 期待と異なる表示の場合の確認順:
  1) ユーザー設定 `~/Library/Application Support/nuriemon/global_settings.json` が残っていないか
  2) 同梱 `resources/global_settings.json` の値（特に `ui.*` と `license.activationRequired`）
  3) 環境変数 `NURIEMON_GLOBAL_SETTINGS_PATH` の指定有無

## Relay（stg）動作確認

1) Relay tail（staging）
```
cd apps/relay-worker
wrangler tail --env=staging
```
→ `pc-auth ok` → `join received` → `fwd cmd` を確認。

2) ライセンス（stg）通しテスト
```
cd apps/license-api
wrangler d1 execute nuriemon-license-stg --file=./schema.sql --env=staging
wrangler secret put SIGNING_JWK --env=staging
wrangler secret put SIGNING_PUBLIC_JWKS --env=staging
wrangler deploy --env=staging

curl -X POST -H "Content-Type: application/json" -H "X-Admin-Api-Key: $ADMIN" \
  -d '{"sku":"NRM-STD","seats":2}' https://license.stg.nuriemon.jp/license/issue
```
→ アプリ側で Event ID を設定 → ライセンス有効化 → QR接続まで動作を確認。

## 署名 / 公証（一般配布）

- 現在は ad-hoc 署名。一般配布では「開発者ID署名＋公証」を行う。
- 準備が整い次第、`tauri.conf.json` の署名設定を反映（別紙）。

## よくある質問

- Q: 本番でRelay設定（ベースURLやPCID）が見えてしまう
  - A: `ui.hideRelaySettings: true` と `ui.lockRelaySettings: true` が有効設定で適用されていない可能性。上記「有効設定の確認」を参照。
- Q: ライセンス未有効化でも使えてしまう
  - A: `license.activationRequired` が false、または Local モードで動作している可能性。一般配布では `true` を推奨。
- Q: stgの `demo`/`studio-` イベントはなぜ通る？
  - A: HMAC経路を限定許可（社内/検証用）。本番イベントではJWT必須。
