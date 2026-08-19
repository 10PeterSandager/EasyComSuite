#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
#  EasyCom — Mac DMG Builder
#  Kør: bash build-mac-dmg.sh
#  Output: dist/  →  "EasyCom Server.dmg", "EasyCom Desktop.dmg", "EasyCom Remote.dmg"
# ─────────────────────────────────────────────────────────────────────────────
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
EASYCOM_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
DIST_DIR="$SCRIPT_DIR/installers"
TMP="$(mktemp -d)"
trap "rm -rf '$TMP'" EXIT

mkdir -p "$DIST_DIR"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
log()  { echo -e "${GREEN}✅ $1${NC}"; }
warn() { echo -e "${YELLOW}⚠️  $1${NC}"; }

make_dmg() {
  local NAME="$1"
  local OUTPUT="$DIST_DIR/${NAME}.dmg"
  hdiutil create \
    -volname "$NAME" \
    -srcfolder "$TMP/$NAME" \
    -ov -format UDZO \
    -o "$OUTPUT" \
    2>/dev/null
  log "Oprettet: $OUTPUT"
}

# ─────────────────────────────────────────────────────────────────────────────
#  SERVER DMG
#  Indeholder: server-kildekode + host-UI-kildekode + launcher
# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo "▶ Building EasyCom Host DMG..."

S="$TMP/EasyCom Host"
mkdir -p "$S/source"

# Kopier kildekode ind i source/ — brugeren ser kun installer-scriptet i roden
rsync -a \
  --exclude='node_modules/' --exclude='dist/' --exclude='.git/' \
  --exclude='installers/' --exclude='build-mac-dmg.sh' --exclude='build-windows-exe.ps1' \
  --exclude='.env' --exclude='*.log' --exclude='tmp/' \
  "$EASYCOM_ROOT/easycom-host/" "$S/source/easycom-host/"

for APP in easycom-broadcast-intercom.nosync DESKTOP easycom-remote; do
  if [ -d "$EASYCOM_ROOT/$APP" ]; then
    rsync -a --exclude='node_modules/' --exclude='dist/' --exclude='.git/' \
      "$EASYCOM_ROOT/$APP/" "$S/source/$APP/"
  else
    warn "$APP ikke fundet — springer over"
  fi
done

cat > "$S/Installer EasyCom Host.command" << 'EOF'
#!/bin/bash
DMG="$(cd "$(dirname "$0")" && pwd)"
DEST="$HOME/EASYCOM.nosync"

clear
printf "\n"
printf "  ╔══════════════════════════════════════╗\n"
printf "  ║       EASYCOM HOST INSTALLER         ║\n"
printf "  ╚══════════════════════════════════════╝\n"
printf "\n"

# ── Kopier kildekode ──────────────────────────────────────────────────────────
printf "  Kopierer filer til %s ...\n" "$DEST"
mkdir -p "$DEST"
rsync -a --exclude=node_modules "$DMG/source/easycom-host/" "$DEST/easycom-host/"
[ -d "$DMG/source/easycom-broadcast-intercom.nosync" ] && \
  rsync -a --exclude=node_modules "$DMG/source/easycom-broadcast-intercom.nosync/" "$DEST/easycom-broadcast-intercom.nosync/"
printf "  ✅ Filer kopieret.\n\n"

# ── Admin-adgangskode ─────────────────────────────────────────────────────────
printf "  Installationen kræver administratoradgang.\n"
sudo -v
if [ $? -ne 0 ]; then
  printf "  ❌ Forkert adgangskode.\n"
  read -rp "  Tryk Enter for at lukke..."
  exit 1
fi
printf "  ✅ Administratoradgang bekræftet.\n\n"

# ── Kør installer ─────────────────────────────────────────────────────────────
sudo bash "$DEST/easycom-host/server/install-mac.sh"
if [ $? -ne 0 ]; then
  printf "\n  ❌ Installationen fejlede. Se fejlbesked ovenfor.\n"
  read -rp "  Tryk Enter for at lukke..."
  exit 1
fi

# ── Opret ikon på skrivebordet ────────────────────────────────────────────────
ELECTRON="$DEST/easycom-host/electron-wrapper/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"
WRAPPER="$DEST/easycom-host/electron-wrapper"
APP="$HOME/Desktop/EasyCom Host.app"

mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cat > "$APP/Contents/MacOS/EasyCom Host" << APPEOF
#!/bin/bash
unset ELECTRON_RUN_AS_NODE
exec "$ELECTRON" "$WRAPPER" 2>/tmp/easycom-electron.log
APPEOF
chmod +x "$APP/Contents/MacOS/EasyCom Host"

cat > "$APP/Contents/Info.plist" << PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleExecutable</key>     <string>EasyCom Host</string>
  <key>CFBundleIdentifier</key>     <string>dk.easycom.host</string>
  <key>CFBundleName</key>           <string>EasyCom Host</string>
  <key>CFBundleVersion</key>        <string>1.0</string>
  <key>CFBundlePackageType</key>    <string>APPL</string>
  <key>LSMinimumSystemVersion</key> <string>12.0</string>
</dict></plist>
PLISTEOF

xattr -cr "$APP" 2>/dev/null
printf "\n  ✅ Ikon oprettet på skrivebordet.\n"

# ── Start EasyCom ─────────────────────────────────────────────────────────────
printf "\n  Starter EasyCom Host...\n"
if [ -f "$ELECTRON" ]; then
  nohup env -u ELECTRON_RUN_AS_NODE "$ELECTRON" "$WRAPPER" > /tmp/easycom-electron.log 2>&1 &
  disown $!
  printf "  ✅ EasyCom Host er startet.\n"
else
  printf "  ⚠️  Electron ikke fundet — start EasyCom Host manuelt fra skrivebordet.\n"
fi

printf "\n"
printf "  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
printf "  ✅ EasyCom Host er installeret!\n"
printf "  Du kan lukke dette vindue.\n"
printf "  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n"
EOF
chmod +x "$S/Installer EasyCom Host.command"

make_dmg "EasyCom Host"

# ─────────────────────────────────────────────────────────────────────────────
#  DESKTOP DMG
#  Indeholder kun launcher — ingen kildekode nødvendig
# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo "▶ Building EasyCom Desktop DMG..."

D="$TMP/EasyCom Desktop"
mkdir -p "$D"
cp "$SCRIPT_DIR/install-desktop-mac.sh" "$D/Installer EasyCom Desktop.command"
chmod +x "$D/Installer EasyCom Desktop.command"

make_dmg "EasyCom Desktop"

# ─────────────────────────────────────────────────────────────────────────────
#  REMOTE DMG
#  Indeholder kun launcher + QR-kode generator
# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo "▶ Building EasyCom Remote DMG..."

R="$TMP/EasyCom Remote"
mkdir -p "$R"
cp "$SCRIPT_DIR/install-remote-mac.sh" "$R/Installer EasyCom Remote.command"
chmod +x "$R/Installer EasyCom Remote.command"

make_dmg "EasyCom Remote"

# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "${GREEN}  ✅ All DMG files ready in: $DIST_DIR${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
ls -lh "$DIST_DIR"/*.dmg
echo ""
