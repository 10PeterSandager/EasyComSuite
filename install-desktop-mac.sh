#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
#  EasyCom Desktop App — macOS Installer
#  Kør: bash install-desktop-mac.sh   (behøver IKKE root)
# ─────────────────────────────────────────────────────────────────────────────
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

log()  { echo -e "${GREEN}✅ $1${NC}"; }
warn() { echo -e "${YELLOW}⚠️  $1${NC}"; }
err()  { echo -e "${RED}❌ $1${NC}"; exit 1; }

echo ""
echo "  ███████╗ █████╗ ███████╗██╗   ██╗ ██████╗ ██████╗ ███╗   ███╗"
echo "  ██╔════╝██╔══██╗██╔════╝╚██╗ ██╔╝██╔════╝██╔═══██╗████╗ ████║"
echo "  █████╗  ███████║███████╗ ╚████╔╝ ██║     ██║   ██║██╔████╔██║"
echo "  ██╔══╝  ██╔══██║╚════██║  ╚██╔╝  ██║     ██║   ██║██║╚██╔╝██║"
echo "  ███████╗██║  ██║███████║   ██║   ╚██████╗╚██████╔╝██║ ╚═╝ ██║"
echo "  ╚══════╝╚═╝  ╚═╝╚══════╝   ╚═╝    ╚═════╝ ╚═════╝ ╚═╝     ╚═╝"
echo "  Desktop App — macOS Installer"
echo ""

DESKTOP_URL="http://localhost:3000/desktop"
DESKTOP_DIR="$HOME/Desktop"
APP_PATH="$DESKTOP_DIR/EasyCom Desktop.app"

# ── Generate EASYCOM Desktop .icns icon (pure Python, no external deps) ───────
python3 - << 'PYEOF'
import zlib, struct, os, shutil, math

def make_png(w, h, pixels):
    def chunk(tag, data):
        crc = zlib.crc32(tag + data) & 0xffffffff
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", crc)
    sig  = b'\x89PNG\r\n\x1a\n'
    ihdr = chunk(b'IHDR', struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0))
    raw  = bytearray()
    for row in range(h):
        raw.append(0)
        for col in range(w):
            raw.extend(pixels[row * w + col])
    return sig + ihdr + chunk(b'IDAT', zlib.compress(bytes(raw), 9)) + chunk(b'IEND', b'')

FONT = {
    'E': ["########","#       ","#       ","######  ","#       ","#       ","#       ","########"],
    'A': ["   ##   "," #    # ","#      #","#      #","########","#      #","#      #","#      #"],
    'S': [" ###### ","#      #","#       "," #####  ","      # ","#      #","#      #"," ###### "],
    'Y': ["#      #"," #    # ","  #  #  ","   ##   ","   ##   ","   ##   ","   ##   ","   ##   "],
    'C': [" ###### ","#      #","#       ","#       ","#       ","#       ","#      #"," ###### "],
    'O': [" ###### ","#      #","#      #","#      #","#      #","#      #","#      #"," ###### "],
    'M': ["#      #","##    ##","# #  # #","#  ##  #","#      #","#      #","#      #","#      #"],
}

# D as a pixel-art letterform: straight left spine, tapered bump on the right
LETTER_D = [
    "###### ",
    "#     ##",
    "#      #",
    "#      #",
    "#      #",
    "#      #",
    "#     ##",
    "###### ",
]

def draw_icon(size):
    dark   = (28,  28,  30,  255)
    white  = (255, 255, 255, 255)
    orange = (248, 115, 22,  255)
    pixels = [dark] * (size * size)

    def px(x, y, color):
        if 0 <= x < size and 0 <= y < size:
            pixels[y * size + x] = color

    cr = int(size * 0.17)
    for y in range(size):
        for x in range(size):
            dx = max(cr - x, 0, x - (size - 1 - cr))
            dy = max(cr - y, 0, y - (size - 1 - cr))
            if dx*dx + dy*dy > cr*cr:
                pixels[y * size + x] = (0, 0, 0, 0)

    bar_h = max(int(size * 0.085), 4)
    for y in range(size - bar_h, size):
        for x in range(size):
            if pixels[y * size + x][3] == 255:
                px(x, y, orange)

    word   = "EASYCOM"
    scale  = max(size // 72, 1)
    cw     = (8 + 1) * scale
    total  = cw * len(word) - scale
    sx0    = (size - total) // 2
    sy0    = max(int(size * 0.10), cr - int(math.sqrt(max(cr*cr - (cr-sx0)**2, 0))) + 4)

    for ci, ch in enumerate(word):
        color = orange if ch == 'O' else white
        bx    = sx0 + ci * cw
        for ri, row_bits in enumerate(FONT.get(ch, FONT['E'])):
            for col_i, bit in enumerate(row_bits):
                if bit == '#':
                    for sy in range(scale):
                        for scx in range(scale):
                            px(bx + col_i*scale + scx, sy0 + ri*scale + sy, color)

    lscale   = max(size // 18, 1)
    L        = 8 * lscale
    lx0      = (size - L) // 2
    text_bot = sy0 + 8 * scale
    bar_top  = size - bar_h
    ly0      = text_bot + (bar_top - text_bot - L) // 2

    for ri, row in enumerate(LETTER_D):
        for ci, bit in enumerate(row.ljust(8)):
            if bit == '#':
                for sy in range(lscale):
                    for sx in range(lscale):
                        px(lx0 + ci*lscale + sx, ly0 + ri*lscale + sy, orange)

    return pixels

iconset = "/tmp/easycom_desktop.iconset"
os.makedirs(iconset, exist_ok=True)
for s in [16, 32, 64, 128, 256, 512, 1024]:
    with open(f"{iconset}/icon_{s}x{s}.png", 'wb') as f:
        f.write(make_png(s, s, draw_icon(s)))
for src, dst in [("32","16x16@2x"),("64","32x32@2x"),("256","128x128@2x"),("512","256x256@2x"),("1024","512x512@2x")]:
    shutil.copy(f"{iconset}/icon_{src}x{src}.png", f"{iconset}/icon_{dst}.png")
PYEOF

iconutil -c icns /tmp/easycom_desktop.iconset -o /tmp/easycom_desktop.icns 2>/dev/null && \
  ICNS_READY=1 || ICNS_READY=0
log "Desktop icon genereret"

# ── Build .app bundle ─────────────────────────────────────────────────────────
rm -rf "$APP_PATH"
mkdir -p "$APP_PATH/Contents/MacOS" "$APP_PATH/Contents/Resources"

cat > "$APP_PATH/Contents/MacOS/EasyCom Desktop" << 'LAUNCHER'
#!/bin/bash
open "http://localhost:3000/desktop"
LAUNCHER
chmod +x "$APP_PATH/Contents/MacOS/EasyCom Desktop"

cat > "$APP_PATH/Contents/Info.plist" << 'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key>       <string>EasyCom Desktop</string>
  <key>CFBundleIdentifier</key>       <string>dk.easycom.desktop</string>
  <key>CFBundleName</key>             <string>EasyCom Desktop</string>
  <key>CFBundleVersion</key>          <string>1.0</string>
  <key>CFBundlePackageType</key>      <string>APPL</string>
  <key>CFBundleIconFile</key>         <string>AppIcon</string>
  <key>LSUIElement</key>              <false/>
  <key>LSMinimumSystemVersion</key>   <string>12.0</string>
</dict>
</plist>
PLIST

[ "$ICNS_READY" = "1" ] && \
  cp /tmp/easycom_desktop.icns "$APP_PATH/Contents/Resources/AppIcon.icns"

xattr -cr "$APP_PATH" 2>/dev/null || true
log "Desktop icon oprettet: EasyCom Desktop.app"

# ── Uninstaller ───────────────────────────────────────────────────────────────
cat > "$DESKTOP_DIR/Afinstaller EasyCom Desktop.command" << EOF
#!/bin/bash
rm -rf "$APP_PATH"
rm -f "$DESKTOP_DIR/Afinstaller EasyCom Desktop.command"
echo "EasyCom Desktop afinstalleret."
EOF
chmod +x "$DESKTOP_DIR/Afinstaller EasyCom Desktop.command"

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "${GREEN}  ✅ EasyCom Desktop klar!${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "  Dobbeltklik på 'EasyCom Desktop' på skrivebordet for at starte."
echo "  URL: $DESKTOP_URL"
echo ""
echo "  Krav: EasyCom Server skal køre på samme maskine (localhost)."
echo "  Er serveren på en anden maskine, skal du redigere launcher-scriptet:"
echo "  $APP_PATH/Contents/MacOS/EasyCom Desktop"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

open "$DESKTOP_URL" 2>/dev/null || true
