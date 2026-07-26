#!/bin/bash
PLIST="/Library/LaunchDaemons/com.easycom.server.plist"
USER_HOME=$(eval echo ~${SUDO_USER:-$USER})
echo "Afinstallerer EasyCom Server..."
launchctl unload "$PLIST" 2>/dev/null || true
rm -f "$PLIST"
rm -rf "$USER_HOME/Desktop/EasyCom Host.app"
echo "Færdig. Servermappen og SSL-certifikatet er bevaret."
