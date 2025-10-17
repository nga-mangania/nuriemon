#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
cd "$SCRIPT_DIR"

echo "[sidecar] Build start (PyInstaller onefile)"
if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 not found. Install Xcode Command Line Tools or Python." >&2
  exit 1
fi

# Ensure pyinstaller and deps (skip when SIDECAR_SKIP_PIP_INSTALL=1)
if [[ "${SIDECAR_SKIP_PIP_INSTALL:-0}" != "1" ]]; then
  python3 -m pip install --upgrade pip
  python3 -m pip install pyinstaller rembg pillow opencv-python-headless numpy
else
  echo "[sidecar] Skipping pip install (SIDECAR_SKIP_PIP_INSTALL=1)"
fi

# Ensure u2net model is available for packaging
MODEL_DIR="$SCRIPT_DIR/models"
MODEL_FILE="$MODEL_DIR/u2net.onnx"
if [[ ! -f "$MODEL_FILE" ]]; then
  if [[ "${SIDECAR_SKIP_MODEL_DOWNLOAD:-0}" == "1" ]]; then
    echo "[sidecar] Model download skipped but $MODEL_FILE not found" >&2
    exit 1
  fi
  echo "[sidecar] Ensuring u2net model at $MODEL_FILE"
  mkdir -p "$MODEL_DIR"
  U2NET_HOME="$MODEL_DIR" RMBG_SESSION_PATH="$MODEL_DIR" python3 - <<'PY'
import os
import sys
import shutil

model_dir = os.environ['U2NET_HOME']
os.makedirs(model_dir, exist_ok=True)

try:
    from rembg.session_factory import new_session
except Exception as exc:
    print(f"[sidecar] rembg import failed: {exc}", file=sys.stderr)
    sys.exit(1)

try:
    session = new_session('u2net')
except Exception as exc:
    print(f"[sidecar] downloading u2net failed: {exc}", file=sys.stderr)
    sys.exit(1)

model_path = getattr(session, 'model_path', None)
if not model_path or not os.path.exists(model_path):
    print(f"[sidecar] u2net model not found after download attempt: {model_path}", file=sys.stderr)
    sys.exit(1)

target = os.path.join(model_dir, 'u2net.onnx')
if os.path.abspath(model_path) != os.path.abspath(target):
    shutil.copy2(model_path, target)
    model_path = target

print(f"[sidecar] u2net model ready: {model_path}")
PY
  if [[ ! -f "$MODEL_FILE" ]]; then
    echo "[sidecar] u2net model missing after download" >&2
    echo "[sidecar] Please download the model manually from https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2net.onnx \
and place it at $MODEL_FILE, or set SIDECAR_SKIP_MODEL_DOWNLOAD=1 once you have copied it." >&2
    exit 1
  fi
else
  echo "[sidecar] Reusing existing model: $MODEL_FILE"
fi

export U2NET_HOME="$MODEL_DIR"
export RMBG_SESSION_PATH="$MODEL_DIR"

# Build (use module form to avoid PATH issues under pyenv/non-login shells)
python3 -m PyInstaller --clean --onefile -n python-sidecar main.py

# Place output at repo's python-sidecar root for bundling (externalBin + fallbacks)
if [[ -f dist/python-sidecar ]]; then
  cp -f dist/python-sidecar "$SCRIPT_DIR/python-sidecar"
  chmod +x "$SCRIPT_DIR/python-sidecar"
  echo "[sidecar] Built binary: $SCRIPT_DIR/python-sidecar"

  TARGET_TRIPLE="${TAURI_TARGET_TRIPLE:-aarch64-apple-darwin}"
  TARGET_PATH="$SCRIPT_DIR/python-sidecar-$TARGET_TRIPLE"
  cp -f dist/python-sidecar "$TARGET_PATH"
  chmod +x "$TARGET_PATH"
  echo "[sidecar] Built binary: $TARGET_PATH"
else
  echo "[sidecar] build failed: dist/python-sidecar not found" >&2
  exit 1
fi

echo "[sidecar] Done"
