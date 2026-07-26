#!/bin/bash

echo "=== EasyCom macOS Installer ==="

NODE_PATH=$(which node)

if [ -z "$NODE_PATH" ]; then
  echo "Node.js not found."
  exit 1
fi

echo "Node found at: $NODE_PATH"

SCRIPT_DIR="$(cd "$(dirname "$0")"; pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.."; pwd)"

APP_PATH="$PROJECT_ROOT/dist/index.js"

if [ ! -f "$APP_PATH" ]; then
  echo "dist/index.js not found at:"
  echo "$APP_PATH"
  echo "Run: npm run build"
  exit 1
fi

echo "App found at: $APP_PATH"

PLIST="$HOME/Library/LaunchAgents/com.easycom.server.plist"

launchctl unload "$PLIST" 2>/dev/null
rm -f "$PLIST"

cat > "$PLIST" <<EOL
<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.easycom.server</string>

    <key>ProgramArguments</key>
    <array>
        <string>$NODE_PATH</string>
        <string>$APP_PATH</string>
    </array>

    <key>RunAtLoad</key>
    <true/>

    <key>KeepAlive</key>
    <true/>

    <key>StandardOutPath</key>
    <string>$PROJECT_ROOT/easycom.log</string>

    <key>StandardErrorPath</key>
    <string>$PROJECT_ROOT/easycom.error.log</string>
</dict>
</plist>
EOL

launchctl load "$PLIST"

echo ""
echo "EasyCom installed successfully."
echo ""
