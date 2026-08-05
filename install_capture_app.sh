#!/bin/bash
# Installerer EasyComCapture.app med eget bundle-ID (com.easycom.capture)
# Kør: bash install_capture_app.sh

set -e

BINARY="/Users/petersandager/EASYCOM/easycom-host/server/src/easycom_audio_capture_new"
APP="/Applications/EasyComCapture.app"

echo "=== Installerer EasyComCapture.app ==="

# 1. Bundle-struktur
sudo mkdir -p "$APP/Contents/MacOS"
sudo cp "$BINARY" "$APP/Contents/MacOS/easycom_audio_capture"
sudo chmod +x "$APP/Contents/MacOS/easycom_audio_capture"

# 2. Info.plist
sudo tee "$APP/Contents/Info.plist" > /dev/null << 'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleIdentifier</key>
    <string>com.easycom.capture</string>
    <key>CFBundleName</key>
    <string>EasyComCapture</string>
    <key>CFBundleVersion</key>
    <string>3.0</string>
    <key>CFBundleShortVersionString</key>
    <string>3.0</string>
    <key>CFBundleExecutable</key>
    <string>easycom_audio_capture</string>
    <key>NSMicrophoneUsageDescription</key>
    <string>EasyComCapture har brug for mikrofonadgang til at fange lyd fra Apollo-interfacet til intercom-systemet.</string>
    <key>LSUIElement</key>
    <true/>
    <key>LSMinimumSystemVersion</key>
    <string>12.0</string>
</dict>
</plist>
PLIST

# 3. Ad-hoc kodesignering (macOS kræver signering for TCC)
sudo codesign --sign - --force --deep "$APP"
echo "✅ App signeret"

# 4. Nulstil evt. gammel TCC-post så den nye dialog vises
tccutil reset Microphone com.easycom.capture 2>/dev/null || true

# 5. Stop LaunchDaemon permanent (den blokkerer for port)
sudo launchctl disable system/com.easycom.server 2>/dev/null || true
sudo kill $(sudo lsof -ti :3001 -sTCP:LISTEN 2>/dev/null) 2>/dev/null || true
sudo kill $(sudo lsof -ti :3000 -sTCP:LISTEN 2>/dev/null) 2>/dev/null || true
echo "✅ LaunchDaemon deaktiveret"

echo ""
echo "=== INSTALLERET ==="
echo "Åbn nu EasyCom fra skrivebordet."
echo "Første gang vil der komme en dialog: 'EasyComCapture vil have adgang til mikrofonen'"
echo "Klik TILLAD — herefter virker det permanent."
echo ""
echo "Bundle: $APP"
ls -la "$APP/Contents/MacOS/"
