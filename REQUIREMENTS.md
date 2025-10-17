以下が**修正済みの全文**です。前回までの議論・合意点をすべて反映し、用語・パス表記・現在実装（/ 将来案）の区別、eventId とライセンスの分離、設定の優先順位、開発と本番の挙動差（CORS）などのブレを解消しています。**省略は一切していません**。

---

# ぬりえもん デスクトップアプリ版 要件定義書（修正済み・最新版）

**最終更新:** 2025-09-02

## プロジェクト概要

### 背景

* 既存の Web アプリケーション「ぬりえもん」（`/Users/nga/oekaki-screen`）をデスクトップアプリ（`/Users/nga/nuriemon`）として再構築。
* ぬりえもんは、子どもが描いた絵や塗り絵を画面で動かして楽しむツール。

### 目的

1. **オフライン運用（Local モード）**
   Local モード時はインターネット接続不要で全機能利用。Relay モード時は TLS 経由で中継通信。
2. **軽量化**
   アプリ本体サイズ 30MB 以下を目標（Python sidecar / モデルは別パッケージまたは初回取得）。
3. **モダン化**
   古いコードベースを刷新し、現行スタックへ。
4. **配布容易性**
   一般ユーザーが簡単にインストール・利用できる形に。
5. **プロダクション品質**
   商用販売できる品質（安定性・セキュリティ・運用性）。
6. **運用モードの二重化**
   **Auto / Relay / Local** の3モードで切替（Phase 5 以降）。

---

## 開発品質基準

### コード品質要件

1. **プロダクションレディ**：試作用で妥協したコードは不可。
2. **アーキテクチャ優先**：設計してから実装。負債を作らない。
3. **パフォーマンス重視**：ポーリング乱用は不可。イベント駆動など適切な手段。
4. **保守性**：拡張しやすい構造・分離。
5. **一貫性**：命名規約・構成・Lint/Format の統一。

### AI 開発者への指示

1. **実装前に設計提示・承認**
2. **改善提案の義務**
3. **問題の早期報告**
4. **ベストプラクティス順守（Tauri/React/Rust など）**

### 品質チェックリスト

* [ ] 商用品質か
* [ ] パフォーマンス最適化
* [ ] エラーハンドリング妥当
* [ ] セキュリティ配慮
* [ ] 拡張性確保
* [ ] テスト（段階導入予定）

---

## 技術選定

* **フレームワーク**: Tauri v2（Rust + WebView）
* **フロント**: React 18+ / TypeScript / Vite
* **スタイル**: CSS Modules + Sass（Tailwind 不採用）
* **画像処理**: Python（rembg/U2Net）→ **sidecar として同梱**（モデルは初回 DL）
* **ローカル DB**: SQLite
* **状態管理**: Zustand（統一済み）
* **オンライン中継**: HTTPS + WebSocket（PC→中継はアウトバウンド1本／スマホは 4G/5G）

---

## 機能要件

### コア機能（移植）

1. **画像アップロード・処理**

   * ファイル選択
   * 背景除去（Python sidecar）
   * 処理済み画像の保存

2. **アニメーション機能**

   * 動き設定（移動・速度・サイズ・タイプ）
   * Canvas 描画
   * BGM/効果音再生

3. **ギャラリー機能**

   * 一覧・削除・編集
   * メタデータ管理（SQLite）

### 新規要件

1. **自動アップデート**（Tauri Updater）
2. **動作モード切替（Auto / Relay / Local）**

   * 初期設定で選択（**デフォルト: Auto**）
   * **Auto**: Relay 到達性が良ければ Relay、不可/劣化時は Local を案内
   * **Relay**: PC は中継へ WS 接続、スマホは 4G/5G で中継へ
   * **Local**: PC 内蔵 Web サーバにスマホが会場 Wi‑Fi で接続（完全オフライン）

---

## 非機能要件

### パフォーマンス

* 起動 ≤ 3 秒
* 背景除去 ≤ 5 秒/枚
* メモリ ≤ 500MB

### セキュリティ

* ローカルデータ暗号化（オプション）
* **Local** は外部通信なし。**Relay** は TLS + WAF/レート制限。
* **トークン/ログ方針**

  * QR は **短命・署名付き・ワンタイム**（60–120 秒）、利用後失効
  * **URL クエリにトークンを載せない**（Referer/ログ漏洩防止）
    → WS は `Sec-WebSocket-Protocol` **または** 初回メッセージで伝送
  * トークン/JTI はマスク・短期保持（7–14 日）

### 配布

* Windows: MSI（コード署名推奨）
* macOS: DMG（公証対応）
* 本体サイズ 30MB 以下目標（sidecar/モデルは別）

---

## システムアーキテクチャ

### 設計原則

1. **ワークスペースベース**（フォルダごと独立）
2. **マルチウィンドウ対応**（アニメ窓・QR表示窓ほか）
3. **イベント駆動**（Tauri イベントで疎結合）
4. **データ一貫性**（DB=正。ストアは派生）
5. **責務分離**（UI/ロジック/データアクセス）

### ディレクトリ構造

```
├── apps
│   └── relay-worker
│       ├── MIGRATION_PLAN.md
│       ├── package.json
│       ├── README.md
│       ├── scripts
│       │   └── signedSmokeTest.mjs
│       ├── src
│       │   └── index.ts
│       ├── tsconfig.json
│       └── wrangler.toml
├── CLAUDE.md
├── dist
│   ├── assets
│   │   ├── cleanupDatabase-4Si8etW_.js
│   │   ├── index-CbO7Dljf.js
│   │   ├── index-DzalDG_R.css
│   │   ├── legacyMigration-D03GM30g.js
│   │   └── webviewWindow-YRN-oxqE.js
│   ├── emotes
│   │   ├── good.svg
│   │   ├── Hello.svg
│   │   ├── hi.svg
│   │   └── wow.svg
│   ├── favicon
│   │   ├── android-chrome-192x192.png
│   │   ├── android-chrome-512x512.png
│   │   ├── apple-touch-icon.png
│   │   ├── browserconfig.xml
│   │   ├── favicon-16x16.png
│   │   ├── favicon-32x32.png
│   │   ├── favicon.ico
│   │   ├── mstile-150x150.png
│   │   ├── safari-pinned-tab.svg
│   │   └── site.webmanifest
│   ├── img
│   │   ├── logo.png
│   │   └── logo.svg
│   ├── index.html
│   ├── tauri.svg
│   ├── vite.svg
│   └── welcome
│       ├── nuriemon_c.png
│       └── nuriemon.png
├── docs
│   └── secure-secrets.md
├── index.html
├── mobile-ui
│   └── dist
│       ├── index.html
│       └── mobile.html
├── new.md
├── package-lock.json
├── package.json
├── public
│   ├── emotes
│   │   ├── good.svg
│   │   ├── Hello.svg
│   │   ├── hi.svg
│   │   └── wow.svg
│   ├── favicon
│   │   ├── android-chrome-192x192.png
│   │   ├── android-chrome-512x512.png
│   │   ├── apple-touch-icon.png
│   │   ├── browserconfig.xml
│   │   ├── favicon-16x16.png
│   │   ├── favicon-32x32.png
│   │   ├── favicon.ico
│   │   ├── mstile-150x150.png
│   │   ├── safari-pinned-tab.svg
│   │   └── site.webmanifest
│   ├── img
│   │   ├── logo.png
│   │   └── logo.svg
│   ├── tauri.svg
│   ├── vite.svg
│   └── welcome
│       ├── nuriemon_c.png
│       └── nuriemon.png
├── python-sidecar
│   ├── main.py
│   ├── requirements.txt
│   └── setup.sh
├── qr-display.html
├── README.md
├── RELEASE.md
├── REQUIREMENTS.md
├── src
│   ├── App.css
│   ├── App.module.scss
│   ├── App.tsx
│   ├── assets
│   │   └── react.svg
│   ├── components
│   │   ├── AnimationPage.module.scss
│   │   ├── AnimationPageSimple.tsx
│   │   ├── AnimationView.module.scss
│   │   ├── AnimationView.tsx
│   │   ├── AudioSettings.module.scss
│   │   ├── AudioSettings.tsx
│   │   ├── BackgroundRemover.module.scss
│   │   ├── BackgroundRemover.tsx
│   │   ├── FileUpload.module.scss
│   │   ├── FileUpload.tsx
│   │   ├── GalleryPage.module.scss
│   │   ├── GalleryPage.tsx
│   │   ├── GroundSetting.module.scss
│   │   ├── GroundSetting.tsx
│   │   ├── ImageGallery.module.scss
│   │   ├── ImageGallery.tsx
│   │   ├── ImagePreview.module.scss
│   │   ├── ImagePreview.tsx
│   │   ├── InitialSetup.tsx
│   │   ├── MovementSettings.module.scss
│   │   ├── MovementSettings.tsx
│   │   ├── SavedImages.module.scss
│   │   ├── SavedImages.tsx
│   │   ├── SettingsPage.module.scss
│   │   ├── SettingsPage.tsx
│   │   ├── ShareUrl.module.scss
│   │   ├── ShareUrl.tsx
│   │   ├── Sidebar
│   │   │   ├── Sidebar.module.scss
│   │   │   └── Sidebar.tsx
│   │   ├── UploadPage.module.scss
│   │   ├── UploadPage.tsx
│   │   ├── WorkspaceSelector.module.scss
│   │   └── WorkspaceSelector.tsx
│   ├── events
│   │   └── tauriEventListener.ts
│   ├── hooks
│   │   ├── useAnimationData.ts
│   │   ├── useAudio.ts
│   │   └── useWorkspace.ts
│   ├── main.tsx
│   ├── protocol
│   │   ├── errors.ts
│   │   └── version.ts
│   ├── services
│   │   ├── animationSettings.ts
│   │   ├── autoDelete.ts
│   │   ├── autoImportService.ts
│   │   ├── cleanupDatabase.ts
│   │   ├── connectivityProbe.ts
│   │   ├── customFileOperations.ts
│   │   ├── database.ts
│   │   ├── fileScope.ts
│   │   ├── globalSettings.ts
│   │   ├── imageStorage.ts
│   │   ├── legacyMigration.ts
│   │   ├── migration.ts
│   │   ├── movementStorage.ts
│   │   ├── pcWsClient.ts
│   │   ├── relayClient.ts
│   │   ├── secureSecrets.ts
│   │   ├── settings.ts
│   │   ├── updateFilePaths.ts
│   │   ├── updater.ts
│   │   └── workspaceManager.ts
│   ├── stores
│   │   ├── appStore.ts
│   │   └── workspaceStore.ts
│   ├── styles
│   │   ├── _variables.scss
│   │   └── reset.scss
│   ├── utils
│   │   ├── image.ts
│   │   ├── runCleanup.ts
│   │   ├── storeSync.ts
│   │   └── tauriStorage.ts
│   ├── vite-env.d.ts
│   └── windows
│       ├── AnimationWindow.module.scss
│       ├── AnimationWindow.tsx
│       ├── QrDisplayWindow.module.scss
│       └── QrDisplayWindow.tsx
├── src-tauri
│   ├── build.rs
│   ├── capabilities
│   │   └── default.json
│   ├── Cargo.lock
│   ├── Cargo.toml
│   ├── gen
│   │   └── schemas
│   │       ├── acl-manifests.json
│   │       ├── capabilities.json
│   │       ├── desktop-schema.json
│   │       └── macOS-schema.json
│   ├── icons
│   │   ├── 128x128.png
│   │   ├── 128x128@2x.png
│   │   ├── 32x32.png
│   │   ├── icon.icns
│   │   ├── icon.ico
│   │   ├── icon.png
│   │   ├── Square107x107Logo.png
│   │   ├── Square142x142Logo.png
│   │   ├── Square150x150Logo.png
│   │   ├── Square284x284Logo.png
│   │   ├── Square30x30Logo.png
│   │   ├── Square310x310Logo.png
│   │   ├── Square44x44Logo.png
│   │   ├── Square71x71Logo.png
│   │   ├── Square89x89Logo.png
│   │   └── StoreLogo.png
│   ├── resources
│   │   ├── global_settings.json
│   │   ├── global_settings.json.example
│   │   ├── global_settings.studio.json
│   │   ├── ja.lproj
│   │   │   └── InfoPlist.strings
│   │   ├── python-sidecar-fallback
│   │   │   └── README.txt
│   │   └── python-sidecar-models
│   │       └── u2net.onnx
│   ├── src
│   │   ├── db.rs
│   │   ├── events.rs
│   │   ├── file_watcher.rs
│   │   ├── lib.rs
│   │   ├── main.rs
│   │   ├── qr_manager.rs
│   │   ├── server_state.rs
│   │   ├── web_server.rs
│   │   ├── websocket.rs
│   │   └── workspace.rs
│   ├── target
│   │   ├── CACHEDIR.TAG
│   │   ├── debug
│   │   │   ├── global_settings.json
│   │   │   ├── global_settings.json.example
│   │   │   ├── libnuriemon_lib.a
│   │   │   ├── libnuriemon_lib.d
│   │   │   ├── libnuriemon_lib.dylib
│   │   │   ├── libnuriemon_lib.rlib
│   │   │   ├── nuriemon
│   │   │   └── nuriemon.d
│   │   └── release
│   │       ├── nuriemon
│   │       └── nuriemon.d
│   └── tauri.conf.json
├── static
│   └── share.html
├── tsconfig.json
├── tsconfig.node.json
└── vite.config.ts
```

### ワークスペース構成

```
<workspace>/
├─ .nuriemon/
│  ├─ nuriemon.db            # SQLite
│  └─ settings.json          # ワークスペース設定
├─ images/
│  ├─ originals/
│  ├─ processed/
│  └─ backgrounds/
└─ audio/
   ├─ bgm-*.mp3
   └─ soundEffect-*.mp3
```

### ウィンドウ間通信（イベント駆動）

```
Rust Backend
  └─(emit)→ Tauri イベント
        └─→ 中央リスナー（TauriEventListener）
              └─→ Zustand ストア
                    └─→ React コンポーネント
                           ↑
                    SQLite（正）
```

* **原則**

  * 単一方向データフロー（DB→イベント→ストア→UI）
  * 設定値はストア、一覧などは DB を正として必要時に再読込
  * 疎結合（直接参照を避ける）

* **主なイベント**

  * `data-changed` / `image-list-updated` / `workspace-changed` / `workspace-settings-updated` / `workspace-data-loaded`

---

## データ移行・保存

### 既存 → 新規

| 旧（Web版）       | 新（デスクトップ版）   |
| ------------- | ------------ |
| Firebase Auth | ローカル（SQLite） |
| Firestore     | SQLite       |
| Cloud Storage | ローカル FS      |
| SendGrid      | OS 通知 等      |
| オンライン共有       | ファイルエクスポート   |

### 保存場所

* **ワークスペース**配下（前述）
* **グローバル設定**（ユーザー単位）

  * **macOS**: `~/Library/Application Support/nuriemon/global_settings.json`
  * **Windows**: `%APPDATA%\nuriemon\global_settings.json`
  * **Linux**: `~/.config/nuriemon/global_settings.json`
  * ※ **小文字 `nuriemon` に統一**

---

## 開発ロードマップ（抜粋）

### Phase 1–4（完了）

* Tauri 基盤、ファイル選択、画像処理（sidecar）、ギャラリー、SQLite、アニメ、保存先選択

### Phase 4.5–4.8（完了）

* マルチウィンドウ / イベント集中化 / Zustand 統一
* 効果音・削除挙動修正、画像更新リアルタイム化

### Phase 5（子ども操作：QR + Auto/Relay/Local）（完了）

* **共通**：画像ごとに QR 表示／スマホをコントローラ化／WS でリアルタイム操作
* **Auto**：Relay 到達性ヘルスで自動判断→不可時は Local 案内
* **Relay**：PC→中継（HTTPS/WS）、スマホ（4G/5G）→中継
* **Local**：PC 内蔵サーバへ会場 Wi‑Fi 接続（自己診断ページ・案内）
* **UI**：アニメ窓に QR は出さない（体験優先）。モバイル UI はシンプル/アドバンス切替。
* **Per-image control**：`img=<imageId>` により個別制御。`payload.imageId` がある場合のみ対象へ反映。

### Phase 6（ユーザー管理・配布準備）（途中）

* **自動アップデート**（GitHub Releases）
* **配布ビルド**（macOS DMG / Windows MSI）
* **署名・公証**（段階導入）
* **（将来）ユーザー/プロファイル**

---

## 運用モード（Auto / Relay / Local）

* **Auto（推奨）**：低頻度ヘルス（`/healthz`）で Relay 可否を判定。可なら Relay、不可/劣化なら Local 案内。

* **Relay**：単一ドメインの中継へ PC/スマホが合流（PC はアウトバウンド1本）。画像/設定は PC ローカル。

* **Local**：会場 Wi‑Fi（または PC ホットスポット）で内蔵サーバへ接続。

* **スケール目標**：直近 1,000–10,000 同時（Cloudflare Workers + Durable Objects）

* **レイテンシ**：95p < 150ms（Relay）

---

## Relay アーキテクチャ（Cloudflare Workers + Durable Objects）

> **実装状況**：本仕様は **EventDO 一元**で運用（現行）。`PcDO` は将来の高スケール向け候補。
> **目的**：PoP/インスタンス差を吸収し、PC/モバイルを確実に同一ハブに集約。

### エンドポイント / プロトコル（現行）

* `POST /e/{event}/register-pc` … PC 登録（HMAC 署名ヘッダで検証）
* `POST /e/{event}/pending-sid` … QR 用 `sid` を pending 登録（TTL）
* `GET  /e/{event}/sid-status?sid=...` … `sid` の状態確認
* `GET  /e/{event}/ws`（**WebSocket**）

  * **サブプロトコル**: `v1`
  * **PC**：接続後に `pc-auth`（HMAC 検証 / nonce 再生攻撃防止 / 時計ズレ補正）→ `pc-ack`
  * **Mobile**：`join { sid }` → `ack`、以降 `cmd` を送信
  * **サーバ**：`evt` をモバイルへブロードキャスト（必要時）

> **注意**：かつての案だった `POST /session` による「モバイル向けワンタイム WS トークン払い出し」は**将来オプション**。現行は `sid` と `pc-auth` の二段で成立。

### ハートビート / 切断通知（現行）

* サーバ→全 WS に 25–30 秒間隔で `{v:1,type:'hb'}`（ログ抑制）
* モバイルは任意で `hb-ack` 返送（生存観測）
* PC が切断したら、同 PC に紐づくモバイルへ `pc-offline` を通知（UI は再接続導線を提示）
  ※ モバイルは 45 秒の猶予後に `pc-timeout` 通知とともに `close(1012)` で切断（通知のみ運用は将来オプション）。

### 署名正規化 v1（HMAC）

* 対象: `register-pc` / `pending-sid`
* ヘッダ:
  `X-Relay-Iat`（UNIX 秒）, `X-Relay-Nonce`（16B base64url）, `X-Relay-Sig`（base64url HMAC）
* 正規化文字列:
  `op + "\n" + path + "\n" + payloadHash + "\n" + iat + "\n" + nonce`

  * `op` = `register-pc` | `pending-sid`
  * `path` 例：`/e/demo-event/pending-sid`
  * `payloadHash`: 受信生ボディ SHA-256 小文字 hex（空は `e3b0c442...b855`）
* 検証: 時計ズレ ±60s / nonce 未使用 / payloadHash 一致 / HMAC 一致
* エラー: 401（E\_CLOCK\_SKEW）→ `X-Server-Time`、409（E\_SID\_EXISTS）、429/503 は `Retry-After`

### QR / セッション（現行）

* QR は **`e`（eventId）と `sid` のみ**を含む（`sid` は base32 10 桁・TTL=90s・I/O/L 除外）。
  例：`https://ctrl.nuriemon.jp/app/#e={event}&sid={sid}`
* PC が先に `pending-sid` で登録 → QR 化 → モバイルが `join {sid}`
* `sid` は DO ストレージで TTL 失効（ワンタイム性は DO が担保）

### レート制限 / バックプレッシャ（設計方針）

* イベント単位 / IP 単位 / セッション単位でレート制御
* 送信キュー上限・coalesce・過負荷時の 503+`Retry-After` と指数バックオフ＋ジッター

---

## セキュリティ / 運用

### マルチテナント / イベント分離

* ルーティング：`/e/{event}`
* レート制限・クォータ：イベント/セッション/クライアント単位
* **キルスイッチ**：特定 event の Relay 停止→ Local 誘導（UI バナー）

### 観測性 / SLO

* **メトリクス**：接続成功率、p50/p95、切断理由、再接続率、bps/接続
* **ダッシュボード**：イベント別リアルタイム
* **SLO**：例）接続成功率 99.5%、95p < 150ms（Relay）

### Local 到達性（将来）

* QR に `http://<ip>:<port>` と `http://<hostname>.local` 併記
* **自己診断ページ → 成功/失敗の案内 → Wi‑Fi 接続 QR**
* AP クライアント隔離の確認手順

### セキュリティヘッダ（UI 配信/リダイレクト）

* `Content-Security-Policy`: `default-src 'self'; connect-src 'self' wss://ctrl.nuriemon.jp`
* `Referrer-Policy`: `no-referrer`
* `Strict-Transport-Security`: `max-age=15552000`

---

## 最近の変更（2025-09-01）

* **Relay/DO**：WS ハートビート（\~25s）、`pc-online` / `pc-offline` 通知。
  ※ PC 復帰なし 45s 超で `pc-timeout` を送りつつモバイルを `close(1012)` で切断（通知のみ運用は将来オプション）。
* **モバイル UI**（/app）：自動再接続（指数バックオフ）＋「再接続」ボタン。`pc-offline`/`pc-online` を UI 反映。
* **画像ごとのコントローラー割当**：`img=<imageId>` を QR に付与、`payload.imageId` を透過保持。
  `imageId` 指定があるときのみ該当画像へ適用（未指定時の全体適用はレガシー互換として限定的に維持）。
* **削除ポリシー**：No-Delete モード廃止／タイマー経過で `delete` を実行しファイルとメタデータを完全削除。手動削除も常に可。
* **画像リストAPI**：processed 専用の Keyset ページング（rowid 基準）と最小列返却で QR/アニメ画面の初期化を軽量化。

---

## アセット配置ガイド

* **UI 直参照**：`public/`

  * 例：`/welcome/hero.png`, `/emotes/good.svg`
* **ビルド管理**：`src/assets/`（import して使用）
* **バックエンド同梱**：`src-tauri/resources/`

  * 例：`global_settings.json`（バンドル既定）
* **ユーザーデータ**：`<workspace>/images/*`, `<workspace>/audio/*`

**エモート追加**

* SVG：`public/emotes/xxx.svg` を追加 → `svgEmotes` に `"xxx"` を登録
* テキスト絵文字：`textEmotes` へ追加候補

---

## グローバル設定 / プロビジョニング（Relay）

### 優先順位（上ほど強い）

1. **環境変数 JSON パス**：`NURIEMON_GLOBAL_SETTINGS_PATH`
2. **ユーザー設定ファイル**：`global_settings.json`

   * macOS: `~/Library/Application Support/nuriemon/global_settings.json`
   * Windows: `%APPDATA%\nuriemon\global_settings.json`
   * Linux: `~/.config/nuriemon/global_settings.json`
3. **バンドル既定**：`src-tauri/resources/global_settings.json`
4. **内部保存（GlobalSettingsService）**
5. **個別キーの環境変数オーバーライド**（起動中のみ）
   `NURIEMON_RELAY_BASE_URL`, `NURIEMON_RELAY_EVENT_ID`, `NURIEMON_PCID`, `NURIEMON_OPERATION_MODE`

> **運用のポイント**
>
> * **社内テストを本番相当**で回す：**バンドル同梱**を推奨（誤編集や置き忘れ防止）。
> * **一般配布**：バンドルには **baseUrl のみ**／`eventId` は空で同梱 → **初回セットアップ画面で購入者が入力**するのが簡潔。

### `global_settings.json` サンプル

**社内テスト（固定 eventId で配る）：**

```json
{
  "version": "1",
  "relay": {
    "baseUrl": "https://stg.ctrl.nuriemon.jp",
    "eventId": "studio-2025-09",
    "pcId": null,
    "wsProtocol": "v1"
  },
  "defaults": { "operationMode": "relay" },
  "ui": { "hideRelaySettings": true, "lockRelaySettings": true }
}
```

**一般配布（購入者が初回に入力）：**

```json
{
  "version": "1",
  "relay": {
    "baseUrl": "https://ctrl.nuriemon.jp",
    "eventId": "",
    "pcId": null,
    "wsProtocol": "v1"
  },
  "defaults": { "operationMode": "relay" },
  "ui": { "hideRelaySettings": false, "lockRelaySettings": false }
}
```

> **EVENT_SETUP_SECRET** ベースの接続は廃止。Relay 接続はライセンス有効化で得たデバイストークン（JWT）のみを使用し、秘密鍵の登録UIは削除済み。

---

## 初回セットアップ（購入者向け UX）

1. **動作モード**選択（Auto / Relay / Local）※ 既定は Relay（一般配布を想定）
2. **eventId 入力**（英数・ハイフン、8–32 文字などルール表示）
3. **pcId 自動生成**（端末固有。グローバルに保存）
4. **保存**：優先順位ルールに従い、通常はユーザー設定ファイルに書き出し。

   * **ワークスペースを変えても eventId/pcId はグローバルで維持**（任意変更は可）

---

## ライセンス（eventId とは独立）

* **ライセンスコード**は配布・台数・不正配布対策のための**別レイヤ**。
* PC アプリは初回起動時にライセンス入力 → **ライセンス認証 Worker（別系統）** へ `activate` → 署名トークン発行。
* 以後、起動チェックはトークンで行い、**eventId とは混同しない**。
* オフライン猶予・台数上限・有効期限などはポリシーで定義。
* ライセンス認証サーバは Cloudflare Workers（KV/R2/DO 等）で実装可。Relay とは**分離**。

---

## 開発を本番挙動に近づける（CORS 回避）

* HMR（`http://localhost:1420`）は CORS で Relay に弾かれる。\*\*本番同等（`tauri://localhost`）\*\*で動かしたい場合：

**推奨 A：dist ウォッチ開発**

* `vite build --watch`（HMR ではなく `dist/` を更新）
* Tauri は `devUrl` を使わず `frontendDist` を読む → **オリジンが `tauri://localhost`** になり CORS 回避。

**代替 B：ステージングで一時的に `http://localhost:1420` を許可**

* `ALLOWED_ORIGINS` に追加（本番は据え置き）。暫定策。

**代替 C：ネットワークをネイティブ経由に統一**

* HTTP：`@tauri-apps/plugin-http` など
* WS：`@tauri-apps/plugin-websocket` または Rust 側で WS → フロントとブリッジ
* dev でも CORS 非依存になるが、実装コストは A・B より高い。

---

## サイドカー（背景除去）

* **方式 A 採用**：**sidecar バイナリ同梱**／モデル（U2Net など）は**初回 DL**してキャッシュ。
* 2 回目以降はオフライン会場でも高速。
* sidecar が見つからない開発時はローカル `python3 main.py` も可（自動切替）。

---

## QA チェックリスト

* [ ] 初回セットアップで eventId 入力 → QR 表示 → モバイル join → PC 反映
* [ ] ワークスペース切替でも eventId/pcId が維持（設定画面で確認）
* [ ] 長時間の操作で途切れない（hb 有効・`pc-offline` 通知が UI に反映）
* [ ] 画像・音声の取り込み/再生がスムーズ（負荷・遅延）
* [ ] 自動アップデート（通知～適用）
* [ ] OS 権限ダイアログ（初回のみ）
* [ ] ギャラリー削除は常に可（自動削除タイマーも設定どおり動作）
* [ ] Per-image control：`imageId` 指定時は対象のみ反映、未指定は全体適用（互換）

---

## よくある質問（抜粋）

**Q. eventId は毎回違う必要がある？**
A. いいえ。同じ会場・端末群で共有する「合流点」です。**一般配布では初回セットアップで購入者に入力**してもらい、その後はグローバルで維持します。

**Q. ライセンスと eventId の関係は？**
A. **無関係**です。ライセンスは配布・台数・不正対策、eventId は PC とモバイルの**紐付けハブ名**です。

**Q. 社内 PC を本番相当で動かすには？**
A. バンドル同梱の `global_settings.json` に **baseUrl と固定の eventId** を入れ、`lockRelaySettings=true` を推奨。

**Q. 購入者が eventId を知らないのでは？**
A. **初回セットアップ画面**で入力してもらう設計に変更済みです（本書に反映）。事前に配布側で決めた命名規則（例：`school-2025-autumn`）を案内します。

---

## 付録：キーと配置まとめ

* **設定の優先順位**：環境変数 > ユーザー設定（`~/Library/Application Support/nuriemon/global_settings.json` ほか）> **バンドル同梱** > 内部保存 > その回だけの環境変数上書き
* **代表キー**

  * `relay.baseUrl`（例：`https://ctrl.nuriemon.jp`）
  * `relay.eventId`（一般配布は空→初回 UI で入力）
  * `relay.pcId`（初回自動生成・グローバル保存）
  * `relay.wsProtocol`（`v1`）
  * `defaults.operationMode`（例：`relay`）
  * `ui.hideRelaySettings` / `ui.lockRelaySettings`（本番は true 推奨）
* **macOS のユーザー配置先**：`~/Library/Application Support/nuriemon/global_settings.json`（**小文字**）

---

## AI の役割

* **codex**：開発実装責任者（実装・検証を担当）
* **GPT-5 Pro**：レビュー・提案・設計指示・設計/実装の整合性チェック

  1. フロント/バック両面からの多角的レビュー
  2. 根本原因の追求と再発防止の提案
  3. 常に仮説検証し、より良い選択肢の提示

---

### 変更の要点（本ドキュメントへの反映）

* **eventId はライセンスと無関係**／**初回セットアップで購入者が入力**／**グローバルで維持**。
* **global\_settings.json の優先順位**・**パス表記を小文字 `nuriemon` に統一**。
* **Relay の現行実装**に合わせ、`/session` トークン発行案は**将来オプション**として分離。
* **PcDO 言及**は将来案へと位置づけ、**現行は EventDO 一元**に統一。
* **CORS と開発手順**（dist ウォッチ）を明記。
* **自動削除タイマーの挙動**（経過時はファイルとDBを削除）／**手動削除は常に可**を明文化。
* **Per-image control** と **pc-offline/online 通知**を仕様化。
* 文言・図表・コードブロックの体裁を全体で整えました。

---------------------------------------------


# 次の予定 (2025/09/08)

結論：**はい、いまは“手動発行（API 直叩き）”まで実装済み**で、
\*\*「Webで購入→自動で購入者へライセンスコード配布」\*\*は “これから” です。
ただし、**license-api（Cloudflare Workers）に Webhook を1本追加**すれば、**今日から自動配布**にできます。

以下、**最短の完成形（Stripe想定）**→そのまま使える**実装手順とサンプルコード**→**運用チェックリスト**の順でまとめます。

---

## 速攻で完成させる構成（MVP）

1. **Webサイトの「購入」ボタン** → Stripe Checkout へ遷移
2. **Stripe Webhook（checkout.session.completed）** → **license-api** の `POST /webhooks/stripe` を呼ぶ
3. Worker が **ライセンスを自動発行**（D1へ保存）→ **購入者へメール送信**（コードと手順）
4. 返金・キャンセル Webhook を**受け取ったら自動失効**（任意）

> 決済代行は Stripe が最も一般的。Paddle/Gumroad などでも同じ考え方（Webhook → 自動発行）です。

---

## 具体的な実装手順（Cloudflare Workers / license-api に追加）

### 0. 前提：価格とSKUの対応を決める

* 例）`price_XXXX` → `sku="NRM-STD"`, `seats=2`
  ※ Checkout で **quantity** を使う場合、`seats = base_seats * quantity` にするなど、ルールを決めます。

### 1. Stripe ダッシュボード設定

* Product/Price を作成（テストモードでOK）
* Webhook 追加

  * **エンドポイントURL**：`https://license.nuriemon.jp/webhooks/stripe`（stg なら `https://stg.license...`）
  * イベント：`checkout.session.completed`（＋返金系は後述）
  * 生成された **Signing secret** を控える（`whsec_***`）

### 2. license-api の Secrets を登録

```bash
# staging / production それぞれで登録
wrangler secret put STRIPE_WEBHOOK_SECRET --env=staging
wrangler secret put STRIPE_WEBHOOK_SECRET --env=""       # prodの top-level
wrangler secret put STRIPE_API_KEY        --env=staging  # line_items取得に使う（任意）
wrangler secret put STRIPE_API_KEY        --env=""
wrangler secret put MAIL_FROM             --env=staging   # 送信元メール (例 no-reply@nuriemon.jp)
wrangler secret put MAIL_FROM             --env=""
```

### 3. D1 に“重複防止”と“注文ログ”用テーブルを足す（任意だが推奨）

```sql
-- migrations に追加
CREATE TABLE IF NOT EXISTS webhook_events (
  id TEXT PRIMARY KEY,           -- Stripe event id (evt_...)
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,           -- checkout.session id (cs_...)
  email TEXT,
  sku TEXT,
  seats INTEGER,
  license_code TEXT,
  status TEXT,                   -- issued/refunded/canceled/...
  created_at INTEGER NOT NULL
);
```

### 4. Worker に `POST /webhooks/stripe` を追加（サンプル）

> ポイント：**署名検証**→**重複防止**→**line\_itemsからSKU/数量取得**→**ライセンス発行**→**メール送信**。

```ts
// apps/license-api/src/webhooks/stripe.ts (例)
export async function handleStripeWebhook(req: Request, env: Env, ctx: ExecutionContext) {
  const sig = req.headers.get('stripe-signature') || "";
  const body = await req.text();

  // 1) Stripe署名検証（v1署名）
  if (!await verifyStripeSignature(body, sig, env.STRIPE_WEBHOOK_SECRET)) {
    return new Response(JSON.stringify({ ok: false, error: { code: "E_BAD_SIG" } }), { status: 400 });
  }

  const event = JSON.parse(body);
  const eventId = event.id as string;

  // 2) 重複防止（同一イベント2回処理しない）
  const existed = await env.DB.prepare(
    "SELECT id FROM webhook_events WHERE id=?"
  ).bind(eventId).first<string>("id");
  if (existed) return json({ ok: true, dedup: true });

  // 3) checkout.session.completed のみ処理
  if (event.type !== "checkout.session.completed") {
    await env.DB.prepare("INSERT INTO webhook_events(id, created_at) VALUES (?, strftime('%s','now'))")
      .bind(eventId).run();
    return json({ ok: true, skipped: event.type });
  }

  const session = event.data.object;
  // 3a) 顧客メール
  const email: string | null = session.customer_details?.email || session.customer_email || null;

  // 3b) line_items を取得（APIキーがある場合）
  let items: Array<{ price: string; quantity: number; }> = [];
  if (env.STRIPE_API_KEY) {
    const r = await fetch(`https://api.stripe.com/v1/checkout/sessions/${session.id}?expand[]=line_items`, {
      headers: { Authorization: `Bearer ${env.STRIPE_API_KEY}` }
    });
    const js = await r.json();
    items = (js.line_items?.data || []).map((li: any) => ({
      price: li.price?.id,
      quantity: li.quantity || 1
    }));
  } else {
    // 代替案：Checkout側で metadata に sku/seats を埋めておき、ここで取り出す
    // items = [{ price: session.metadata.price_id, quantity: Number(session.metadata.qty || 1) }];
  }

  // 3c) price_id → SKU/SEATS のマッピング（例）
  const map: Record<string, { sku: string; seats: number }> = {
    "price_XXXX_STANDARD": { sku: "NRM-STD", seats: 2 },
    "price_YYYY_PRO":      { sku: "NRM-PRO", seats: 5 }
  };

  // 4) ライセンス発行（itemsを走査して合計seatsを計算、1決済1コードにする例）
  let totalSeats = 0;
  let sku = "NRM-STD";
  for (const it of items) {
    const def = map[it.price];
    if (!def) continue;
    sku = def.sku;                         // 単一SKU前提なら最後の定義を採用
    totalSeats += def.seats * (it.quantity || 1);
  }
  if (totalSeats === 0) totalSeats = 2;    // フォールバック

  const code = genLicenseCode("NRM-STD-"); // 例：NRM-STD-<16桁>
  // 既存の発行ロジックに合わせて D1 へ insert
  await env.DB.prepare(
    "INSERT INTO licenses(code, sku, seats, status, issued_at) VALUES (?, ?, ?, 'active', strftime('%s','now'))"
  ).bind(code, sku, totalSeats).run();

  // orders へ記録
  await env.DB.prepare(
    "INSERT INTO orders(id, email, sku, seats, license_code, status, created_at) VALUES (?, ?, ?, ?, ?, 'issued', strftime('%s','now'))"
  ).bind(session.id, email, sku, totalSeats, code).run();

  // webhook_events へ記録（重複防止）
  await env.DB.prepare("INSERT INTO webhook_events(id, created_at) VALUES (?, strftime('%s','now'))")
    .bind(eventId).run();

  // 5) 送信（MailChannels 例：追加のAPIキー不要でWorkersから送れる）
  if (email) {
    await sendMailViaMailchannels(env.MAIL_FROM, email, "Nuriemon ライセンスのご案内",
`ご購入ありがとうございます。
以下があなたのライセンスコードです。

ライセンスコード: ${code}

セットアップ手順:
1) アプリを起動 → Settings → License
2) ライセンスコードを入力して「有効化」
3) Event ID を入力し接続

不明点はサポートへご連絡ください。`);
  }

  return json({ ok: true, issued: { code, sku, seats: totalSeats } });

  // --- helpers ---
  function json(obj: any, init: ResponseInit = {}) {
    return new Response(JSON.stringify(obj), {
      status: 200, headers: { "content-type": "application/json" }, ...init
    });
  }
}

function genLicenseCode(prefix = "NRM-STD-") {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  const s = [...arr].map(n => alphabet[n % alphabet.length]).join("");
  // 4-4-4-4 など区切りたい場合は適宜整形
  return prefix + s.slice(0,4)+"-"+s.slice(4,8)+"-"+s.slice(8,12)+"-"+s.slice(12,16);
}

async function verifyStripeSignature(payload: string, sigHeader: string, secret: string) {
  try {
    // header: t=timestamp, v1=signature
    const parts = Object.fromEntries(sigHeader.split(",").map(kv => {
      const [k, v] = kv.split("=");
      return [k.trim(), v];
    }));
    const signedPayload = `${parts["t"]}.${payload}`;
    const key = await crypto.subtle.importKey(
      "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]
    );
    const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signedPayload));
    const expected = [...new Uint8Array(mac)].map(b => b.toString(16).padStart(2, "0")).join("");
    // 比較（一定時間比較に簡略化：実運用はタイムリークを避けた比較関数に差し替え可）
    return (parts["v1"] || "").toLowerCase() === expected.toLowerCase();
  } catch {
    return false;
  }
}

async function sendMailViaMailchannels(from: string, to: string, subject: string, text: string) {
  const payload = {
    personalizations: [{ to: [{ email: to }] }],
    from: { email: from, name: "Nuriemon" },
    subject, content: [{ type: "text/plain", value: text }]
  };
  await fetch("https://api.mailchannels.net/tx/v1/send", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
}
```

> すでに `POST /license/issue` があるなら、**同一Worker内の関数呼び出し**に寄せるか、**内部関数を共通化**してください。
> **idempotency** は `webhook_events` テーブルで担保。**二重送信しても二重発行しない**ようにしています。

### 5. 返金・キャンセルで自動失効（任意）

* Webhook に `charge.refunded`, `payment_intent.canceled`, `customer.subscription.deleted` などを追加
* `orders.status` を更新し、該当ライセンスを `status='revoked'` に更新（必要なら `revoked_jti` へも反映）

---

## テストの流れ（Stripe テストモード）

1. Checkout（テストカード 4242…）で購入
2. Stripe が Webhook を license-api に送る
3. D1 の `orders` と `licenses` に insert され、購入者メールに **ライセンスコード**が飛ぶ
4. アプリの **\[Settings] → \[License]** にコードを入力 → **有効化 → 接続**

---

## よくある質問

* **Q. 成約後、画面にもコードを出したい**

  * `success_url` に `?session_id={CHECKOUT_SESSION_ID}` を付けて遷移 →
    フロントから **GET `/purchase/license?session_id=...`** を叩いて、
    サーバ側で Stripe API から session を再確認（paid か＆未発行か）→ ライセンスを返す。
  * ただし **画面表示だけだと控えを失いがち**なので **メール送付は必須**を推奨。

* **Q. どのディレクトリで作業する？**

  * **license-api プロジェクト内**（あなたの `apps/license-api`）に上記エンドポイントを追加、Secrets を設定して **`wrangler deploy`**。
  * Webhook のURLは **stg/prod それぞれのカスタムドメイン**を指定。

---

## 運用チェックリスト（本番移行前）

* [ ] Stripe の **Webhook Signing Secret** を stg/prod で Secrets 登録
* [ ] price\_id ↔ sku/seats の **マッピング**をコードに反映
* [ ] `webhook_events` / `orders` テーブルの **migration** を適用
* [ ] **二重発行なし**（同一イベント複投でも1コード）を確認
* [ ] **メール送信**が届く（MailChannels or 既存の送信サービス）
* [ ] 返金時の **自動失効**が期待通り（任意）

---

## 他サービス（Paddle/Gumroad）でも？

* 仕組みは同じ：**Webhook** を受けて **ライセンス発行** → **メール**
* 署名検証やイベント名が異なるだけ。Workers 側に検証関数を足すだけで対応可能です。

---

**ここまでやれば**、一般的な SaaS と同様に
\*\*「Web購入 → 自動でライセンスメール」\*\*が完成します。
上記の追加コードを入れる形で進めましょう。もし望めば、**実プロジェクトに合わせた差分パッチ**（ファイル単位）を作ってお渡しします。


# 2025/09/24 追記
なるべく開発環境と本番で異なる挙動にならないように注意する。
(開発ではライセンスコード不要で、本番は必要など)


ビルド方法
1
export APPLE_DEVELOPER_ID="Developer ID Application: NGA, Inc. (87KUWA497A)"
2
appleシリコン
./scripts/build-macos-dmg.sh
Intelシリコン
./scripts/build-macos-dmg-intel.sh