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

SIDE_ENT="src-tauri/macos/entitlements-sidecar.plist"
if [[ ! -f "$SIDE_ENT" ]]; then
  echo "[sign-macos] Sidecar entitlements not found: $SIDE_ENT" >&2
  exit 1
fi

for bin in \
  "$APP_PATH/Contents/MacOS/python-sidecar" \
  "$APP_PATH/Contents/MacOS/python-sidecar-aarch64-apple-darwin"; do
  if [[ -x "$bin" ]]; then
    echo "[sign-macos] Signing bundled python-sidecar: $bin"
    codesign "${SIGN_ARGS[@]}" --entitlements "$SIDE_ENT" "$bin"
  fi
done
for legacy_root in \
  "$APP_PATH/Contents/Resources/python-sidecar" \
  "$APP_PATH/Contents/Resources/python-sidecar-fallback"; do
  if [[ -x "$legacy_root/python-sidecar" ]]; then
  echo "[sign-macos] Signing legacy resource python-sidecar: $legacy_root/python-sidecar"
  codesign "${SIGN_ARGS[@]}" --entitlements "$SIDE_ENT" "$legacy_root/python-sidecar"
fi
done

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
