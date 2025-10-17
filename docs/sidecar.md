# Sidecar のネイティブ化（推奨）

配布先で Python/venv/pip を不要にし、初回から安定・高速に動作させるために、`python-sidecar` を単一バイナリ化して同梱します。

## macOS (arm64) の手順（開発機で実行）

```
# 1) 依存導入
python3 -m pip install --upgrade pip
python3 -m pip install pyinstaller rembg pillow opencv-python-headless numpy

# 2) ビルド
# ネットワークに出られない環境では `SIDECAR_SKIP_PIP_INSTALL=1` を付与し、既存の pyinstaller / rembg などを再利用できます。
SIDECAR_SKIP_PIP_INSTALL=1 bash ./python-sidecar/build_sidecar_macos.sh
# ネットワークが使えずモデルを手動配置する場合は `SIDECAR_SKIP_MODEL_DOWNLOAD=1` を併用し、`python-sidecar/models/u2net.onnx` を事前に用意する
# → python-sidecar/python-sidecar と python-sidecar/python-sidecar-aarch64-apple-darwin、加えて python-sidecar/models/u2net.onnx が整備される

# 3) アプリのビルド
npm run tauri build
```

`tauri.conf.json` の `bundle.externalBin` でサイドカーを登録しているため、`python-sidecar/python-sidecar-aarch64-apple-darwin` が `Nuriemon.app/Contents/MacOS/` へ組み込まれ、codesign（Hardened Runtime + timestamp）も自動で適用されます。フォールバック用の `main.py` / `requirements.txt` は `bundle.resources` で `Resources/python-sidecar-fallback/` 以下へコピーされます。開発中は `python-sidecar`（拡張子なし）も残るため、従来どおり直接起動できます。

## 起動順序（アプリ側）

1. 同梱ネイティブバイナリ（`Contents/MacOS/python-sidecar`）があればそれを起動（`U2NET_HOME` は `Contents/Resources/python-sidecar-models/` を指す）
2. なければ `Resources/python-sidecar-fallback/main.py`（or 旧バージョンの `Resources/python-sidecar/main.py`）を `python3` で起動（この場合も `U2NET_HOME` は `Resources/python-sidecar-models/`）
3. 最後に開発相対パス `../python-sidecar/main.py`

## トラブルシュート

- バイナリが起動しない: ターミナル起動時の stderr に `[sidecar:stderr]` が出ます。依存不足や権限エラーを確認してください。
- Intel 向け: Intel 環境で同手順を実施し、`python-sidecar` を差し替えるか、配布物を別アーキで用意します。
- Hardened Runtime 下で動作させるため、ビルド後に `scripts/sign-macos.sh` が `src-tauri/macos/entitlements-sidecar.plist` を使って sidecar を再署名します（`com.apple.security.cs.disable-library-validation`）。
- Hardened Runtime 下で動作させるため、ビルド後に `scripts/sign-macos.sh` が `src-tauri/macos/entitlements-sidecar.plist` を使って sidecar を再署名します（`com.apple.security.cs.disable-library-validation`、`com.apple.security.cs.allow-jit`、`com.apple.security.cs.allow-unsigned-executable-memory`）。
