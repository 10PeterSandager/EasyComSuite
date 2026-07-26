#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
#  EasyCom Remote App — macOS Installer
#  Kør: bash install-remote-mac.sh   (behøver IKKE root)
#  Bruges typisk på teknikermaskinen for at generere QR-kode til talent
# ─────────────────────────────────────────────────────────────────────────────
set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()  { echo -e "${GREEN}✅ $1${NC}"; }
warn() { echo -e "${YELLOW}⚠️  $1${NC}"; }

echo ""
echo "  ███████╗ █████╗ ███████╗██╗   ██╗ ██████╗ ██████╗ ███╗   ███╗"
echo "  ██╔════╝██╔══██╗██╔════╝╚██╗ ██╔╝██╔════╝██╔═══██╗████╗ ████║"
echo "  █████╗  ███████║███████╗ ╚████╔╝ ██║     ██║   ██║██╔████╔██║"
echo "  ██╔══╝  ██╔══██║╚════██║  ╚██╔╝  ██║     ██║   ██║██║╚██╔╝██║"
echo "  ███████╗██║  ██║███████║   ██║   ╚██████╗╚██████╔╝██║ ╚═╝ ██║"
echo "  ╚══════╝╚═╝  ╚═╝╚══════╝   ╚═╝    ╚═════╝ ╚═════╝ ╚═╝     ╚═╝"
echo "  Remote App — macOS Installer (QR-kode generator)"
echo ""

# ── Collect server domain ─────────────────────────────────────────────────────
echo "Hvad er EasyCom-serverens adresse?"
read -p "  Server domain (f.eks. myeasycom.duckdns.org): " DOMAIN
echo ""

REMOTE_URL="https://$DOMAIN:3000/remote"
DESKTOP_DIR="$HOME/Desktop"
QR_FILE="$DESKTOP_DIR/EasyCom Remote QR.html"

# ── Desktop shortcut ──────────────────────────────────────────────────────────
cat > "$DESKTOP_DIR/EasyCom Remote.webloc" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>URL</key>
  <string>$REMOTE_URL</string>
</dict>
</plist>
EOF
log "Skrivebordsgenvej oprettet: EasyCom Remote"

# ── QR-kode HTML (åbnes i browser — scan med telefon) ────────────────────────
cat > "$QR_FILE" << HTMLEOF
<!DOCTYPE html>
<html lang="da">
<head>
<meta charset="UTF-8">
<title>EasyCom Remote — QR-kode</title>
<style>
  body { background:#111; color:#eee; font-family:sans-serif; display:flex; flex-direction:column; align-items:center; justify-content:center; min-height:100vh; margin:0 }
  h1 { color:#f97316; margin-bottom:8px; font-size:1.6rem }
  p  { color:#94a3b8; margin:4px 0 24px; font-size:.95rem }
  #qr { background:#fff; padding:16px; border-radius:12px }
  a  { color:#f97316; font-size:.85rem; margin-top:20px; word-break:break-all }
</style>
</head>
<body>
<h1>EasyCom Remote</h1>
<p>Scan med talent-telefonen for at åbne appen</p>
<div id="qr"></div>
<a href="$REMOTE_URL" target="_blank">$REMOTE_URL</a>
<script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
<script>
  new QRCode(document.getElementById('qr'), {
    text: "$REMOTE_URL",
    width: 260,
    height: 260,
    colorDark: "#000",
    colorLight: "#fff",
    correctLevel: QRCode.CorrectLevel.H
  })
</script>
</body>
</html>
HTMLEOF

open "$QR_FILE"
log "QR-kode åbnet i browser"

# ── Uninstaller ───────────────────────────────────────────────────────────────
cat > "$DESKTOP_DIR/Afinstaller EasyCom Remote.command" << EOF
#!/bin/bash
rm -f "$DESKTOP_DIR/EasyCom Remote.webloc"
rm -f "$DESKTOP_DIR/EasyCom Remote QR.html"
rm -f "$DESKTOP_DIR/Afinstaller EasyCom Remote.command"
echo "EasyCom Remote afinstalleret."
EOF
chmod +x "$DESKTOP_DIR/Afinstaller EasyCom Remote.command"
log "Afinstallationsgenvej oprettet"

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "${GREEN}  ✅ EasyCom Remote klar!${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "  QR-koden er åbnet i browseren."
echo "  Vis den til talent/artisten — de scanner den med telefonen."
echo ""
echo "  URL: $REMOTE_URL"
echo "  Krav: EasyCom Server skal køre på $DOMAIN"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
