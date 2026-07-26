#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
#  EasyCom Server — macOS Installer
# ─────────────────────────────────────────────────────────────────────────────
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SERVICE_NAME="com.easycom.server"
PLIST_PATH="/Library/LaunchDaemons/${SERVICE_NAME}.plist"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
log()  { echo -e "${GREEN}✅ $1${NC}"; }
warn() { echo -e "${YELLOW}⚠️  $1${NC}"; }
err()  { echo -e "${RED}❌ $1${NC}"; exit 1; }

GUI_USER="${SUDO_USER:-$(stat -f '%Su' /dev/console 2>/dev/null || echo "$USER")}"
_gui() { sudo -u "$GUI_USER" osascript "$@" 2>/dev/null; }

echo ""
echo "  ███████╗ █████╗ ███████╗██╗   ██╗ ██████╗ ██████╗ ███╗   ███╗"
echo "  ██╔════╝██╔══██╗██╔════╝╚██╗ ██╔╝██╔════╝██╔═══██╗████╗ ████║"
echo "  █████╗  ███████║███████╗ ╚████╔╝ ██║     ██║   ██║██╔████╔██║"
echo "  ██╔══╝  ██╔══██║╚════██║  ╚██╔╝  ██║     ██║   ██║██║╚██╔╝██║"
echo "  ███████╗██║  ██║███████║   ██║   ╚██████╗╚██████╔╝██║ ╚═╝ ██║"
echo "  ╚══════╝╚═╝  ╚═╝╚══════╝   ╚═╝    ╚═════╝ ╚═════╝ ╚═╝     ╚═╝"
echo "  Broadcast Intercom Server — macOS Installer"
echo ""

if [ "$EUID" -ne 0 ]; then
  err "Please run as root: sudo bash install-mac.sh"
fi

# ── Homebrew ──────────────────────────────────────────────────────────────────
if ! command -v brew &>/dev/null; then
  warn "Homebrew not found. Installing..."
  sudo -u "$GUI_USER" /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
fi
log "Homebrew ready"

# ── Node.js ───────────────────────────────────────────────────────────────────
if ! command -v node &>/dev/null; then
  warn "Node.js not found. Installing..."
  sudo -u "$GUI_USER" brew install node
fi
NODE_PATH=$(command -v node)
log "Node.js ready ($(node --version))"

# ── ffmpeg ────────────────────────────────────────────────────────────────────
if ! command -v ffmpeg &>/dev/null && [ ! -f /opt/homebrew/bin/ffmpeg ]; then
  warn "ffmpeg not found. Installing..."
  sudo -u "$GUI_USER" brew install ffmpeg
fi
log "ffmpeg ready"

# ── Auto-detect local IP ──────────────────────────────────────────────────────
LOCAL_IP=$(ipconfig getifaddr en0 2>/dev/null || \
           ipconfig getifaddr en1 2>/dev/null || \
           ipconfig getifaddr en2 2>/dev/null || echo "127.0.0.1")
log "Local IP: $LOCAL_IP"

# ── Self-signed SSL cert (covers localhost + LAN IP) ─────────────────────────
SSL_DIR="/etc/easycom/ssl"
mkdir -p "$SSL_DIR"
openssl req -x509 -newkey rsa:2048 \
  -keyout "$SSL_DIR/key.pem" -out "$SSL_DIR/cert.pem" \
  -days 3650 -nodes \
  -subj "/CN=easycom-local" \
  -addext "subjectAltName=IP:127.0.0.1,IP:$LOCAL_IP,DNS:localhost" 2>/dev/null
chmod 644 "$SSL_DIR/cert.pem" "$SSL_DIR/key.pem"
# Trust the cert system-wide so Chrome/Safari accept it without warnings
security add-trusted-cert -d -r trustRoot \
  -k /Library/Keychains/System.keychain "$SSL_DIR/cert.pem" 2>/dev/null || \
  warn "Kunne ikke tilføje cert til System Keychain — kør manuelt: sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain $SSL_DIR/cert.pem"
log "SSL certificate ready ($LOCAL_IP + localhost)"

# ── Write default .env (user configures via host UI Setup tab) ────────────────
if [ ! -f "$SCRIPT_DIR/.env" ]; then
  cat > "$SCRIPT_DIR/.env" << EOF
PORT=3000
MEDIASOUP_ANNOUNCED_IP=$LOCAL_IP
TURN_URL=
TURN_USERNAME=
TURN_PASSWORD=
SESSION_PASSWORD=
SSL_CERT_PATH=
SSL_KEY_PATH=
EOF
  log ".env created — server kører HTTP på LAN (SSL_CERT_PATH er tom, aktivér via Setup → Server ved internetadgang)"
else
  # Update SSL paths if missing, keep existing config
  grep -q "SSL_CERT_PATH" "$SCRIPT_DIR/.env" || \
    echo "SSL_CERT_PATH=$SSL_DIR/cert.pem" >> "$SCRIPT_DIR/.env"
  grep -q "SSL_KEY_PATH" "$SCRIPT_DIR/.env" || \
    echo "SSL_KEY_PATH=$SSL_DIR/key.pem" >> "$SCRIPT_DIR/.env"
  log ".env exists — preserving config"
fi

# ── Install dependencies ──────────────────────────────────────────────────────
echo "Installing Node dependencies..."
cd "$SCRIPT_DIR"
sudo -u "$GUI_USER" npm install --silent
log "Dependencies installed"

# ── Build server ──────────────────────────────────────────────────────────────
echo "Building server..."
sudo -u "$GUI_USER" npm run build --silent
log "Server built"

# ── Build host UI ─────────────────────────────────────────────────────────────
for APP_DIR in "$SCRIPT_DIR/../../easycom-broadcast-intercom"; do
  APP_NAME=$(basename "$APP_DIR")
  if [ -d "$APP_DIR" ]; then
    echo "Building $APP_NAME..."
    cd "$APP_DIR"
    sudo -u "$GUI_USER" npm install --silent
    sudo -u "$GUI_USER" npm run build --silent
    log "$APP_NAME built"
  else
    warn "$APP_NAME ikke fundet — springer over"
  fi
done
cd "$SCRIPT_DIR"

# ── launchd service ───────────────────────────────────────────────────────────
cat > "$PLIST_PATH" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>         <string>${SERVICE_NAME}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${NODE_PATH}</string>
    <string>${SCRIPT_DIR}/dist/server.js</string>
  </array>
  <key>WorkingDirectory</key> <string>${SCRIPT_DIR}</string>
  <key>RunAtLoad</key>        <true/>
  <key>KeepAlive</key>        <true/>
  <key>ThrottleInterval</key> <integer>10</integer>
  <key>StandardOutPath</key>  <string>/var/log/easycom.log</string>
  <key>StandardErrorPath</key><string>/var/log/easycom-error.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
  </dict>
</dict>
</plist>
EOF
launchctl unload "$PLIST_PATH" 2>/dev/null || true
launchctl load "$PLIST_PATH"
log "Auto-start service registered"

# ── Uninstaller ───────────────────────────────────────────────────────────────
cat > "$SCRIPT_DIR/uninstall-mac.sh" << 'UNEOF'
#!/bin/bash
PLIST="/Library/LaunchDaemons/com.easycom.server.plist"
USER_HOME=$(eval echo ~${SUDO_USER:-$USER})
echo "Afinstallerer EasyCom Server..."
launchctl unload "$PLIST" 2>/dev/null || true
rm -f "$PLIST"
rm -rf "$USER_HOME/Desktop/EasyCom Host.app"
echo "Færdig. Servermappen og SSL-certifikatet er bevaret."
UNEOF
chmod +x "$SCRIPT_DIR/uninstall-mac.sh"

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "${GREEN}  ✅ EasyCom Server installed and running!${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "  Host app  →  $HOST_URL"
echo "  Ikon er oprettet på skrivebordet."
echo ""
echo "  Åbn Host-UI og gå til SETUP → SERVER"
echo "  for at konfigurere TURN-server og adgangskode."
echo ""
echo "  Serveren starter automatisk ved genstart."
echo "  Logs: tail -f /var/log/easycom.log"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

_gui \
  -e "set m to \"EasyCom Server er installeret og kører!\" & return & return & \"Åbn Host-UI og gå til SETUP → SERVER for at konfigurere TURN og adgangskode.\"" \
  -e "button returned of (display alert \"EasyCom installeret\" message m as informational buttons {\"Åbn Host\"} default button \"Åbn Host\")" \
  2>/dev/null

_gui -e "open location \"$HOST_URL\"" 2>/dev/null || true
