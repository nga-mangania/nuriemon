#!/usr/bin/env bash
set -euo pipefail

TARGET="x86_64-apple-darwin"
APP_DIR="src-tauri/target/$TARGET/release/bundle/macos"
APP_PATH="$APP_DIR/Nuriemon.app"
DMG_DIR="src-tauri/target/$TARGET/release/bundle/dmg"
DMG_PATH="$DMG_DIR/Nuriemon_0.1.0_x86_64_signed.dmg"
IDENTITY="${APPLE_DEVELOPER_ID:-Developer ID Application: NGA, Inc. (87KUWA497A)}"

ORIG_DMG="$DMG_DIR/Nuriemon_0.1.0_x86_64.dmg"

echo "[build-macos-dmg-intel] Building app+DMG via Tauri..."
npm run tauri build -- --target "$TARGET" --bundles dmg

if [[ ! -f "$ORIG_DMG" ]]; then
  echo "[build-macos-dmg-intel] Expected DMG not found: $ORIG_DMG" >&2
  exit 1
fi

TMP_ROOT="$(mktemp -d)"
MNT_POINT="$TMP_ROOT/mnt"
EXTRACT_ROOT="$TMP_ROOT/src"
EXTRACT_APP="$EXTRACT_ROOT/Nuriemon.app"

cleanup() {
  if mount | grep -q "$MNT_POINT" >/dev/null 2>&1; then
    hdiutil detach "$MNT_POINT" -quiet || true
  fi
  rm -rf "$TMP_ROOT"
}
trap cleanup EXIT

mkdir -p "$MNT_POINT"
echo "[build-macos-dmg-intel] Mounting original DMG to extract contents..."
hdiutil attach "$ORIG_DMG" -mountpoint "$MNT_POINT" -nobrowse -quiet
cp -R "$MNT_POINT/." "$EXTRACT_ROOT"
hdiutil detach "$MNT_POINT" -quiet

if [[ ! -d "$EXTRACT_APP" ]]; then
  echo "[build-macos-dmg-intel] Extracted app not found: $EXTRACT_APP" >&2
  exit 1
fi

echo "[build-macos-dmg-intel] Re-signing extracted app sidecar..."
APPLE_DEVELOPER_ID="$IDENTITY" scripts/sign-macos.sh "$EXTRACT_APP"

NOTARIZE_READY=false
if [[ -n "${APPLE_API_KEY_PATH:-}" && -n "${APPLE_API_KEY:-}" && -n "${APPLE_API_ISSUER:-}" ]]; then
  NOTARIZE_READY=true
fi

if [[ "$NOTARIZE_READY" == true ]]; then
  APP_ZIP="$TMP_ROOT/Nuriemon.zip"
  echo "[build-macos-dmg-intel] Preparing ZIP for notarization..."
  ditto -c -k --keepParent "$EXTRACT_APP" "$APP_ZIP"

  echo "[build-macos-dmg-intel] Submitting to notarytool (wait)..."
  xcrun notarytool submit "$APP_ZIP" \
    --key "$APPLE_API_KEY_PATH" \
    --key-id "$APPLE_API_KEY" \
    --issuer "$APPLE_API_ISSUER" \
    --wait

  echo "[build-macos-dmg-intel] Stapling app..."
  xcrun stapler staple "$EXTRACT_APP"
else
  echo "[build-macos-dmg-intel] APPLE_API_* env not set, skipping notarization"
fi

echo "[build-macos-dmg-intel] Creating new DMG..."
mkdir -p "$DMG_DIR"
rm -f "$DMG_PATH"
hdiutil create -volname "Nuriemon" \
  -srcfolder "$EXTRACT_ROOT" \
  -fs APFS -ov "$DMG_PATH"

if [[ "$NOTARIZE_READY" == true ]]; then
  echo "[build-macos-dmg-intel] Stapling DMG..."
  xcrun stapler staple "$DMG_PATH"
fi

echo "[build-macos-dmg-intel] Done: $DMG_PATH"
