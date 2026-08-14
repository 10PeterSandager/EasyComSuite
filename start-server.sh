#!/bin/bash
# Restore built dist from git before starting (prevents iCloud reversion)
cd "$(dirname "$0")/../../easycom-broadcast-intercom" 2>/dev/null && git checkout -- dist/ 2>/dev/null || true
# Start server
exec /usr/local/bin/node "$(dirname "$0")/dist/server.js"
