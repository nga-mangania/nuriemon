#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
cd "$SCRIPT_DIR"

echo "[sidecar] Build start (PyInstaller onefile)"
if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 not found. Install Xcode Command Line Tools or Python." >&2
  exit 1
fi

# Ensure pyinstaller and deps
python3 -m pip install --upgrade pip
python3 -m pip install pyinstaller rembg pillow opencv-python-headless numpy

# Build
pyinstaller --clean --onefile -n python-sidecar main.py

# Place output at repo's python-sidecar root for bundling (Resources/python-sidecar)
if [[ -f dist/python-sidecar ]]; then
  cp -f dist/python-sidecar "$SCRIPT_DIR/python-sidecar"
  chmod +x "$SCRIPT_DIR/python-sidecar"
  echo "[sidecar] Built binary: $SCRIPT_DIR/python-sidecar"
else
  echo "[sidecar] build failed: dist/python-sidecar not found" >&2
  exit 1
fi

echo "[sidecar] Done"

