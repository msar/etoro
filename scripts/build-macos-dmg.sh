#!/usr/bin/env bash
# Build a shareable Portfolio-Evolution.dmg from the in-repo .app + bootstrap.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP_SRC="$ROOT/Portfolio Evolution.app"
BOOTSTRAP_SRC="$ROOT/scripts/bootstrap-macos.sh"
STAGING="$ROOT/dist/dmg-staging"
VOL_NAME="Portfolio Evolution"
DMG_PATH="$ROOT/dist/Portfolio-Evolution.dmg"
TMP_DMG="$ROOT/dist/Portfolio-Evolution.rw.dmg"

die() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

[[ -d "$APP_SRC" ]] || die "Missing $APP_SRC"
[[ -f "$BOOTSTRAP_SRC" ]] || die "Missing $BOOTSTRAP_SRC"
[[ -f "$APP_SRC/Contents/MacOS/launcher" ]] || die "Missing app launcher"
command -v hdiutil >/dev/null || die "hdiutil not found (macOS only)"

echo "Syncing bootstrap into .app Resources…"
cp "$BOOTSTRAP_SRC" "$APP_SRC/Contents/Resources/bootstrap-macos.sh"
chmod +x "$APP_SRC/Contents/MacOS/launcher"
chmod +x "$APP_SRC/Contents/Resources/bootstrap-macos.sh"

echo "Staging DMG contents…"
rm -rf "$STAGING"
mkdir -p "$STAGING"
# Copy the thin .app only (no project source inside the DMG)
ditto "$APP_SRC" "$STAGING/Portfolio Evolution.app"
ln -s /Applications "$STAGING/Applications"

# Drop a short readme for recipients
cat >"$STAGING/How to install.txt" <<'EOF'
Portfolio Evolution — install

1. Drag "Portfolio Evolution" into the Applications folder.
2. Open Applications and double-click Portfolio Evolution.
3. The first time, macOS may block the app (it is not notarized).
   Right-click the app → Open → Open.
4. Wait while it downloads the latest code and starts.
   Your browser will open to http://localhost:5173

Your credentials stay on this Mac under:
  ~/Library/Application Support/Portfolio Evolution/

Updates download automatically each time you open the app.
EOF

echo "Creating DMG…"
mkdir -p "$ROOT/dist"
rm -f "$DMG_PATH" "$TMP_DMG"

hdiutil create \
  -volname "$VOL_NAME" \
  -srcfolder "$STAGING" \
  -ov \
  -format UDRW \
  "$TMP_DMG"

hdiutil convert "$TMP_DMG" -format UDZO -imagekey zlib-level=9 -o "$DMG_PATH"
rm -f "$TMP_DMG"
rm -rf "$STAGING"

echo ""
echo "Built: $DMG_PATH"
echo "Share that file — recipients do not need git or a clone."
