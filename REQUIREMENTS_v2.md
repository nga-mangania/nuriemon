了解！下記は **codex への実装指示書**（そのままチケット/PRの見出しに使える構成）です。
バージョンを **V1: 吹き出しテキストのみ（Gemini 2.0 Flash‑Lite で短文生成）** → **V2: 端末内 STT/TTS を追加** の二段階で設計しています。
既存のアーキテクチャ（Zustand 中心のイベント駆動・設定優先順位・配布モード等）に沿わせています。

---

# 指示書: 「アニメ画像が自動で吹き出し発話」機能

## 目的

* **V1（最短）**: アニメーション画面の各画像に、定期的に**短いセリフ**（例:「こんにちは」「元気？」）を**吹き出し**で表示。音声なし。
* **V2（拡張）**: 端末内 **STT/TTS（無料系・オフライン）** を組み合わせ、**マイクで話しかけ → テキスト応答 → 合成音声で再生**を追加。

> いずれも **Relay/Local いずれの運用モードでも動作**し、オフライン時は「安全な定型文 or 端末内生成」にフォールバックする。設定の読み込み/優先順位や配布形態は既存仕様に厳密に合わせること。

---

## 範囲（Scope）

### V1（今リリースに載せる）

* **UI**: 吹き出しのレンダリング（各キャラクタ/画像ごと）。
* **生成**: Gemini 2.0 Flash‑Lite による**10文字以内の短文**生成（日本語優先、絵柄に依存しない汎用フレーズ）。
* **頻度**: 既定 **30–45秒/回**・ランダムゆらぎ±10s、各画像ごとに**クールダウン**あり（直近発話の重複回避）。
* **コスト制御**:

  * 同時アクティブ画像数に応じ **同時呼び出し最大 N=2**（キュー化）
  * **1端末/日 上限 M=200 リクエスト**（超過時はローカル定型文へ）。
* **安全対策**: 語彙ホワイトリスト/文字種制限・長さ制限・NGワードフィルタ（簡易）。
* **設定**: `global_settings.json` に機能スイッチ/頻度/プロバイダ設定を追加（後述）。ユーザー設定 > 同梱 > 内部保存の優先順位を厳守。
* **オフライン**: ネット不可/429/5xx 時は**ローカル定型文**（ひらがな/カタカナ中心）に自動フォールバック。

### V2（次段）

* **STT（端末内）**: 例）**Vosk**（軽量・オフライン）。
  マイク→Vosk（日本語モデル）→短文テキスト。
* **対話**: STT 結果を Gemini 2.0 Flash‑Lite に渡し**短文応答**（V1 と同じ安全&長さ制限）を返す。
* **TTS（端末内）**: 例）**Piper** もしくは **COQUI-TTS** の軽量日本語モデル。
  短文を wav に合成→アプリ内で再生（既存のオーディオ再生系を流用）。
* **UI**: アニメ側は吹き出し+音声再生、モバイル側は「話しかけてね」補助表示（必要に応じて）。

---

## 仕様詳細

### 1) 設定キー（`global_settings.json`）

`src-tauri/resources/global_settings.json`（同梱既定）＋ユーザー配置先に従う。小文字 `nuriemon` パス統一・優先順位は既存仕様通り。

```jsonc
{
  "ai": {
    "speechBubble": {
      "enabled": true,           // 機能ON/OFF
      "provider": "gemini-lite", // "gemini-lite" | "local"
      "lang": "ja",
      "minIntervalSec": 30,      // 次発話までの最小秒
      "jitterSec": 10,           // ばらつき
      "maxDailyCalls": 200,      // 上限、超過でlocal
      "maxConcurrent": 2,        // 同時生成数
      "maxChars": 12,            // 文字数上限（吹き出しに収める）
      "allowEmoji": true         // 絵文字許容
    }
  }
}
```

> **運用**: デフォルトONだが provider を `"local"` にすれば\*\*完全ローカル（費用ゼロ）\*\*運用が可能。
> **秘匿情報**: Gemini API キーは OS キーチェーン/シークレット保存で扱い、設定ファイルに書かない（既存の secureSecrets 流儀に合わせる）。

### 2) コンポーネントと責務

* **新規** `src/services/aiText.ts`

  * `AiTextProvider` インターフェース

    * `generateShort(textHints: string[], opts: { lang: string, maxChars: number }): Promise<string>`
  * 実装:

    * `GeminiFlashLiteProvider`（REST/SDKどちらでも可。APIキーは secureSecrets から）
    * `LocalPhraseProvider`（ローカル定型文・マルコフ等は不要。配列からランダム）
* **新規** `src/services/speechBubble.ts`

  * タイマー/キュー/重複ガード/日次カウンタ
  * 画像IDごとに「次回時刻」を管理、生成→**Zustand** に「imageId→phrase」を publish
* **既存改修** `src/components/AnimationView.tsx`

  * 画像スプライトの上に**吹き出し**を絶対配置（CSS）
  * `useAnimationData()` / ストアから `bubbles[imageId]` を購読し描画
* **既存改修** `src/stores/workspaceStore.ts` or `appStore.ts`

  * `bubbles: Record<string, { text: string; t: number }>` を追加
  * `setBubble(imageId, text)` / `clearBubble(imageId)` アクション

### 3) Gemini 2.0 Flash‑Lite 呼び出し（擬似コード）

> 最新の SDK / REST 仕様は実装時にダッシュボードで確認のこと（バージョン名・エンドポイントは変動しうるため、**アダプタ内に隔離**）。
> 送るのは**短いプロンプト**のみ（個人情報・画像データは送らない）。

```ts
// src/services/aiText.ts (抜粋)
export class GeminiFlashLiteProvider implements AiTextProvider {
  constructor(private apiKey: string) {}
  async generateShort(hints: string[], opts: { lang: string; maxChars: number }): Promise<string> {
    const sys = [
      "あなたは子ども向けのやさしい相手です。",
      "短く、感じよく、2〜10文字程度で返事してください。",
      "絵や写真の内容を決めつけないでください。",
      "敬語は不要。かわいく、やさしく。"
    ].join(" ");
    const user = `言語:${opts.lang}。例:${hints.join(" / ")}。1つだけ返答。句読点は省略可。最大${opts.maxChars}文字。`;

    // 実装時、Gemini 2.0 Flash-Lite の正規APIに合わせて変更
    const res = await fetch(GEMINI_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": this.apiKey },
      body: JSON.stringify({ systemInstruction: sys, contents: [{ parts: [{ text: user }]}] })
    });
    const data = await res.json();
    const text = extractText(data) || "";
    return sanitize(text, opts.maxChars); // 文字種/長さ/NGワードを最終フィルタ
  }
}
```

**サニタイズ規則（最終ゲート）**

* `maxChars` 超は切り詰め
* 許可文字: ひらがな/カタカナ/英数/スペース/一部記号/絵文字（設定で切替）
* NGワード表（簡易）に一致で却下→ローカル定型文へ

### 4) ローカル定型文（フォールバック）

`public/emotes/` 既存アセットに合わせて雰囲気統一。
例: `["やった！","こんにちは","すごい","うれしい","いいね","がんばれ","わーい","えへへ","わくわく"]`

### 5) 吹き出し UI

**CSS（例・概略）**

```scss
.bubble {
  position: absolute;
  transform: translate(-50%, -100%);
  padding: 6px 10px;
  border-radius: 12px;
  background: rgba(255,255,255,.95);
  box-shadow: 0 4px 12px rgba(0,0,0,.15);
  font-size: 16px; line-height: 1;
  max-width: 200px; text-align: center;
  &:after { /* 吹き出し三角 */ }
  animation: fadeIn .15s ease-out;
}
```

* 文字数上限に合わせ `font-size` 自動縮小（必要なら）
* **同一画像に新規セリフ到着 → 前のバブルはフェードアウト後に差し替え**

### 6) スケジューラのルール

* 画像が**画面内 & アクティブ**のときのみ対象
* 直近 60 秒以内にユーザー操作/モバイル操作があれば**次発話を遅延**（邪魔しない）
* 同じセリフの**連発を禁止**（最近3件は避ける）
* 画像数が多いときは「先着順で最大同時 N=2」を配分

### 7) トラッキング/コスト

* 端末ローカルに「当日リクエスト数」カウンタ保存（plugin-store）
* `maxDailyCalls` 超はその日は**ローカル定型文固定**
* 追加ログ: `ai.gen.ok` / `ai.gen.fallback` / `ai.gen.limit` を Console に

---

## V2 追加仕様（音声）

### STT（候補）

* **Vosk**（BSD, オフライン, 軽量）

  * サイドカー Python で `vosk` を動かすか、Rust バインディング採用。
  * モデルは初回起動時にダウンロード/キャッシュ（サイズ注意）。

### TTS（候補）

* **Piper**（軽量・品質良い） or **COQUI-TTS**

  * 端末内で wav 生成 → 既存のオーディオ再生機構へ。
  * 速度/ピッチ調整の UI は簡易スライダーで※V2.1以降でも可。

### パイプライン

```
Mic → STT(ローカル) → テキスト
          ↓
     Gemini 2.0 Flash‑Lite（短文応答）
          ↓
    サニタイズ/最大文字数
          ↓
   吹き出し表示 + TTS(ローカル)再生
```

### 追加設定（V2）

```jsonc
"ai": {
  "voice": {
    "enabled": true,
    "stt": { "engine": "vosk", "lang": "ja" },
    "tts": { "engine": "piper", "voice": "ja-JP", "speed": 1.0 }
  }
}
```

---

## 実装手順（タスク分割）

1. **設定と型定義**

   * `global_settings.json` に `ai.speechBubble` を追加。型/デフォルト値を `GlobalSettingsService` に反映。
2. **Provider 抽象化**

   * `src/services/aiText.ts` 作成（`AiTextProvider` / Gemini / Local 実装、サニタイズ含む）。
   * Gemini API キーは `secureSecrets` で保存/取得（UIには露出しない）。
3. **スケジューラ**

   * `src/services/speechBubble.ts` を作り、画像リストと視認状態を監視（既存のアニメ描画/状態にフック）。
   * 発話タイミングの決定・キュー・重複回避・カウンタ管理を実装。
4. **ストア拡張**

   * `bubbles` ステートと `setBubble/clearBubble` を追加（Zustand）。
5. **UI 組み込み**

   * `AnimationView.tsx` に吹き出しを描画。画像の座標/サイズから位置を算出。
6. **フォールバック文言**

   * `LocalPhraseProvider` に定型文（日本語短文）を実装。ユニットテストで**長さ・文字種**を検証。
7. **ガード&テレメトリ**

   * `maxDailyCalls` 超過時の動作、ネットワーク・429・5xx時のフォールバック確認。
8. **設定UI（任意・社内向け）**

   * 開発ビルドのみ `ai` セクションを表示可能に（本番は隠す）。切り替え時はストアに反映。
9. **V2（別PR）**

   * サイドカーに STT/TTS を追加。モデル取得/キャッシュ/再生まで。UIに「話しかけてね」ボタン。

---

## 受け入れ基準（V1）

* [ ] 吹き出しが**30–45秒**間隔（±10s）で表示され、**10〜12文字以内**の日本語短文が出る
* [ ] オフライン時やレート超過時は**定型文**に自動フォールバック
* [ ] **同文の連発がない**（最近3つ重複回避）
* [ ] 端末再起動後も**日次上限が維持**される（翌日リセット）
* [ ] アニメの動作や操作を阻害しない（ユーザー操作直後は遅延）
* [ ] 設定で `enabled=false` にすると**完全無効**になる
* [ ] 個人情報・画像本体は外部送信しない（プロンプトは**定型のヒントのみ**）

---

## セキュリティ/プライバシー注意

* **外部送信禁止**: 子どもの作品画像や固有名詞を LLM に送らない。プロンプトは「やさしい短文を返す」ための**固定ヒント**のみ。
* **暴言/過激表現の排除**: サニタイズ\&NGワード/文字種制限を最後に必ず通す。
* **鍵管理**: Gemini API キーは OS キーチェーンなどのセキュアストレージ。UI露出禁止。

---

## 開発メモ

* 既存の**イベント駆動/ストア一元**の流儀を堅持（UIはストア購読だけに）。
* 配布モード（Auto/Relay/Local）に依存しない動作。Local でも定型文で動く。
* 将来、**モバイルの操作イベント**（例: いいね/拍手）をヒントに渡す拡張は容易（`hints` に絵文字/意図を足すだけ）。

---

### すぐ動かすための最小コード（骨格）

**`src/services/aiText.ts`（骨子）**

```ts
export interface AiTextProvider {
  generateShort(hints: string[], o:{lang:string;maxChars:number}): Promise<string>;
}
export class LocalPhraseProvider implements AiTextProvider {
  private list = ["こんにちは","やった！","うれしい","すごい","わーい","えへへ","いいね","がんばれ"];
  async generateShort(_: string[], o:{lang:string;maxChars:number}) {
    const t = this.list[Math.floor(Math.random()*this.list.length)];
    return sanitize(t, o.maxChars);
  }
}
// GeminiFlashLiteProvider …前述の擬似コード参照
export function sanitize(s:string, max:number){
  const t = s.trim().slice(0, max);
  const ok = /^[\p{L}\p{N}\p{Emoji}\s!?ぁ-んァ-ヶーｦ-ﾟー・、。！？]+$/u.test(t);
  return ok ? t : "えへへ";
}
```

**`src/services/speechBubble.ts`（骨子）**

```ts
type ImageId = string;
export class SpeechBubbleScheduler {
  constructor(private provider: AiTextProvider, private cfg: Cfg){}
  start(images: ()=>ImageId[]) { /* setIntervalで巡回、次回時刻を管理 */ }
  private async tickOne(id: ImageId) { /* 生成→store.setBubble(id, text) */ }
}
```

**`AnimationView.tsx`（描画の要点）**

```tsx
{images.map(img => (
  <div key={img.id} style={{position:'absolute', left: img.x, top: img.y}}>
    {/* スプライト */}
    <Sprite {...img}/>
    {/* 吹き出し */}
    {bubbles[img.id] && (
      <div className="bubble">{bubbles[img.id].text}</div>
    )}
  </div>
))}
```

---

これで **V1: “短い吹き出し発話”** は、端末内だけでも動作します（外部APIなし＝コストゼロ）。
**Gemini 2.0 Flash‑Lite**を有効にすると軽量な多様化ができ、**日次上限/同時数**でコストをコントロールします。
**V2**はこの土台に **STT/TTS** を差し込むだけで拡張できます。

ーーーーーー


#ボタン割り当て
将来的にボタン割り当てなどをコントローラー側にも反映したくなった場合
  は、Cloudflare Worker を経由した仕組みを足せば十分対応できます。たと
  えば：

  - Worker が /controller-config のような API を持ち、モバイル UI の初
  期化時に JSON 設定を取得する。
  - その設定を Durable Object や KV に保存しておき、PC アプリから管理画
  面経由で更新できるようにする。
  - あるいは Worker がコントローラー HTML をサーバーサイドで生成し、設
  定値を埋め込んだ状態でレスポンスする。

  といった方法が考えられます。つまり、今後ボタン割り当て等を動的に変え
  たい要件になっても、Cloudflare Worker を“設定配信サーバー”として使う
  ことで十分実現可能です。


# ライセンス & Relay 同期改善メモ (開発経緯)

## 背景
- Relay 側の JWT 認証は `sub` (pcId) とリクエストの `pcid` が一致することを前提にしている。
- 開発環境では過去に CLI で任意の pcId を指定し、トークンを使い回していたため、アプリ自動採番の pcId と不整合が発生。
- 不整合の結果、Relay が `E_BAD_TOKEN` を返し続け、QR 画面で「ライセンス情報を再有効化してください」のダイアログがループしていた。
- さらに `secureSecrets` を利用した HMAC フォールバックが残っており、JWT を統一フローにできていなかった。

## 目的
1. 「ライセンス必須 ＋ JWT 接続」を開発・本番で統一する。
2. pcId と JWT の `sub` を常に一致させ、誤って他の端末トークンを使えないようにする。
3. 座席上限 (seats) を Activation 時に厳密に検証し、既に使用中のライセンスは 409 で弾く。
4. QR 画面のエラー UI を改善し、失敗時の無限ダイアログを防止する。
5. Tauri 開発環境でも本番と同じ `tauri://localhost` で動作させ、CORS を根本的に解消する。

## 変更概要

### ライセンス API (`apps/license-api/src/index.ts`)
- `/activate` で座席数を超えて新規端末が登録される場合、既存端末を強制解除せず `409 E_SEAT_LIMIT` を返すよう修正。
- 同じ pcId で再有効化する場合は既存レコードを上書きするため、端末入れ替えは UI から明示的に行う想定。

### フロントエンド
- `SettingsPage.tsx`: pcId は自動採番 & 表示のみ。再生成時はライセンストークンを削除し、再有効化を促すプロンプトを追加。
- `licenseClient.ts`, `relayClient.ts`, `pcWsClient.ts`: HMAC フォールバックを廃止し、JWT 必須のコードパスに統一。
- `QrDisplayWindow.tsx`: Relay 失敗時にプレースホルダーを挟み、無限リトライ／ダイアログループを防止。エラーメッセージを明示し、再試行ボタンを提供。
- `secureSecrets.ts` は不要になったため削除。`docs/secure-secrets.md` も同様に削除。

### Tauri (開発環境)
- `tauri.conf.json` と `package.json` で `build.beforeDevCommand = "npm run dev:dist"` を維持しつつ、`tauri dev -- --dev-path ../dist` で dist を直接読めるよう `tauri:dist` スクリプトを追加。
- Tauri CLI は `@tauri-apps/cli@2.6.2` と `@tauri-apps/cli-darwin-universal@2.6.2` を利用する想定（Apple シリコンで Rosetta を使うため）。
- Tauri 側の npm パッケージ（`@tauri-apps/api` など）は Cargo 側 (tauri v2.6.x) と minor を合わせた。

### CORS / 環境設定
- `~/Library/Application Support/com.nuriemon.app/global_settings.json` が `relay_base_url` を最優先で読み込むため、本番 URL に書き換えてからライセンスを再有効化する手順を確認。
- `window.location.origin` が `tauri://localhost` であることを DevTools で確認し、`http://127.0.0.1:1430` では操作しないことを運用手順に明記。

## 残作業 / 注意点
- `npm install` 時に Rollup や Tauri CLI のネイティブバイナリが欠けた場合は `rm -rf node_modules package-lock.json && npm install` で再取得。
- Tauri CLI が見つからない場合は `npm install --save-dev @tauri-apps/cli@2.6.2 @tauri-apps/cli-darwin-universal@2.6.2` を手動で実行。
- 開発時は `npm run build -- --watch` と `npm run tauri dev -- --dev-path ../dist` の組み合わせで起動し、CORS を避ける。
- ライセンスコードを再発行したら、Settings 画面で再有効化し、JWT の `sub` と `pcId` の一致を保つ。
- CLI から Relay API をテストする場合は、必ずアプリと同じ `pcId` を使う。

