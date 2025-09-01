# EVENT_SETUP_SECRET の安全保存（OS キーチェーン）

- 保存先: OS キーチェーン（macOS Keychain / Windows Credential Manager / Linux Secret Service）。
- 利用不可環境ではメモリ保持にフォールバック（再起動で消える旨をUIで通知）。
- 環境別: `staging` / `production` を分離保存。
- サービス/アカウント: `service = "nuriemon"`, `account = "event_setup_secret:{env}"`。

## 使い方（アプリ）
- 設定 → Relay設定 → EVENT_SETUP_SECRET（安全保存）で登録/削除。
- 表示はマスク（末尾4文字のみ）。Reveal/Hide 切替あり。
- レガシー移行: 旧 `event_setup_secret` がワークスペース設定に平文であれば、初回ロードでキーチェーンへ移送し、旧値は空に上書きします。

## リレー署名
- `relayClient` は HMAC 直前にOSキーチェーンから読み出します。未設定なら `E_MISSING_SECRET` を返し、UIが設定画面へ誘導します。

## E2E（stg）
1. サーバ: `wrangler secret put EVENT_SETUP_SECRET --env=staging` → `wrangler deploy --env=staging`。
2. アプリ: 設定で接続先=「検証（stg）」、EventID/PCIDを設定、EVENT_SETUP_SECRETに同値を登録。
3. QR画面で画像QRを生成 → `register-pc` → `pending-sid` → QR表示まで通ること。
4. 401 + `X-Server-Time` は自動再署名で成功。429/503 は `Retry-After` を尊重。Auto時に失敗すればLocalへフォールバック表示。

## 開発メモ
- 鍵の生成例: `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`。
- stg/prod は別値を推奨。サーバ（wrangler secret）とアプリ（キーチェーン）に同一値を登録する。

