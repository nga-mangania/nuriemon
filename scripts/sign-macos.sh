#!/usr/bin/env bash
set -euo pipefail

APP_PATH="${1:-src-tauri/target/universal-apple-darwin/release/bundle/macos/Nuriemon.app}"
if [[ ! -d "$APP_PATH" ]]; then
  echo "[sign-macos] App bundle not found: $APP_PATH" >&2
  exit 1
fi

IDENTITY=${APPLE_DEVELOPER_ID:-}
if [[ -z "$IDENTITY" ]]; then
  echo "[sign-macos] Please export APPLE_DEVELOPER_ID (Developer ID Application: ... (87KUWA497A))" >&2
  exit 1
fi

SIGN_ARGS=(--force --options runtime --timestamp --sign "$IDENTITY")

SIDECAR_ROOT="$APP_PATH/Contents/Resources/python-sidecar"
if [[ -x "$SIDECAR_ROOT/python-sidecar" ]]; then
  echo "[sign-macos] Signing python-sidecar"
  codesign "${SIGN_ARGS[@]}" "$SIDECAR_ROOT/python-sidecar"
fi
if [[ -x "$SIDECAR_ROOT/dist/python-sidecar" ]]; then
  echo "[sign-macos] Signing python-sidecar dist binary"
  codesign "${SIGN_ARGS[@]}" "$SIDECAR_ROOT/dist/python-sidecar"
fi

MAIN_EXEC="$APP_PATH/Contents/MacOS/Nuriemon"
if [[ ! -x "$MAIN_EXEC" ]]; then
  ALT_EXEC="$APP_PATH/Contents/MacOS/nuriemon"
  if [[ -x "$ALT_EXEC" ]]; then
    MAIN_EXEC="$ALT_EXEC"
  fi
fi
if [[ -x "$MAIN_EXEC" ]]; then
  echo "[sign-macos] Signing main executable"
  codesign "${SIGN_ARGS[@]}" "$MAIN_EXEC"
fi

echo "[sign-macos] Signing app bundle"
codesign "${SIGN_ARGS[@]}" "$APP_PATH"

echo "[sign-macos] Verifying signature"
codesign --verify --deep --strict --verbose=2 "$APP_PATH"
