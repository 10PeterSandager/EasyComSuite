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

for APP in easycom-broadcast-intercom DESKTOP easycom-remote; do
  if [ -d "$EASYCOM_ROOT/$APP" ]; then
    rsync -a --exclude='node_modules/' --exclude='dist/' --exclude='.git/' \
      "$EASYCOM_ROOT/$APP/" "$S/source/$APP/"
  else
    warn "$APP ikke fundet — springer over"
  fi
done

# GUI-launcher (.command kopierer kilden, beder om sudo, åbner GUI-installeren)
cat > "$S/Installer EasyCom Host.command" << 'EOF'
#!/bin/bash
DMG="$(cd "$(dirname "$0")" && pwd)"
DEST="$HOME/EasyCom"

clear
echo ""
echo "  ╔══════════════════════════════════════╗"
echo "  ║       EASYCOM SERVER INSTALLER       ║"
echo "  ╚══════════════════════════════════════╝"
echo ""
echo "  Kopierer EasyCom til $DEST ..."
mkdir -p "$DEST"
rsync -a --exclude=node_modules "$DMG/source/easycom-host/" "$DEST/easycom-host/"
[ -d "$DMG/source/easycom-broadcast-intercom" ] && \
  rsync -a --exclude=node_modules "$DMG/source/easycom-broadcast-intercom/" "$DEST/easycom-broadcast-intercom/"
echo "  Kopi færdig."
echo ""

# Bed om admin-adgangskode her i Terminal — ét enkelt prompt, ingen pop-up dialoger
echo "  Installationen kræver administratoradgang."
sudo -v
if [ $? -ne 0 ]; then
  echo "  ❌ Forkert adgangskode. Prøv igen."
  exit 1
fi
echo ""
echo "  ✅ Administratoradgang bekræftet."
echo "  Åbner installer-interface i browseren..."
echo ""

# Frigør Python helt fra Terminal (nohup + disown) så Terminal kan lukke rent
nohup python3 "$DEST/easycom-host/server/install-mac-gui.py" \
  > /tmp/easycom-gui.log 2>&1 &
disown $!

sleep 1.5
echo "  Browser åben. Dette vindue kan lukkes."
sleep 1
exit 0
EOF
chmod +x "$S/Installer EasyCom Host.command"

# Inkluder GUI-installer scriptet
cp "$SCRIPT_DIR/install-mac-gui.py" "$S/source/easycom-host/server/install-mac-gui.py"

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
