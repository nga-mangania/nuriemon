# Sidecar のネイティブ化（推奨）

配布先で Python/venv/pip を不要にし、初回から安定・高速に動作させるために、`python-sidecar` を単一バイナリ化して同梱します。

## macOS (arm64) の手順（開発機で実行）

```
# 1) 依存導入
python3 -m pip install --upgrade pip
python3 -m pip install pyinstaller rembg pillow opencv-python-headless numpy

# 2) ビルド
bash ./python-sidecar/build_sidecar_macos.sh
# → python-sidecar/python-sidecar が生成される（実行可能）

# 3) アプリのビルド
npm run tauri build
```

`tauri.conf.json` の `bundle.resources` で `../python-sidecar` を `Resources/python-sidecar` に同梱するため、生成されたバイナリは自動的に .app 内へコピーされます。

## 起動順序（アプリ側）

1. 同梱ネイティブバイナリ（`Resources/python-sidecar/python-sidecar`）があればそれを起動
2. なければ `Resources/python-sidecar/main.py` を `python3` で起動（フォールバック）
3. 最後に開発相対パス `../python-sidecar/main.py`

## トラブルシュート

- バイナリが起動しない: ターミナル起動時の stderr に `[sidecar:stderr]` が出ます。依存不足や権限エラーを確認してください。
- Intel 向け: Intel 環境で同手順を実施し、`python-sidecar` を差し替えるか、配布物を別アーキで用意します。

