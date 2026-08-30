"use strict";
// backup.ts – Active/passive failover for EasyCom
//
// Role "main":  syncs state to backup every SYNC_INTERVAL ms
// Role "backup": receives state, waits for takeover command
//
// On takeover: backup applies cached state + broadcasts host:relocated to clients
Object.defineProperty(exports, "__esModule", { value: true });
exports.getBackupStatus = getBackupStatus;
exports.setupBackupRoutes = setupBackupRoutes;
exports.emitBackupConfig = emitBackupConfig;
const SYNC_INTERVAL = 5000; // ms between state pushes
const SYNC_TIMEOUT = 3000; // ms before giving up on one push
let _role = "main";
let _backupUrl = null; // only relevant when role=main
let _syncInterval = null;
let _cachedState = null;
let _lastSyncAt = null; // epoch ms (as backup: last time we received sync)
let _lastSendAt = null; // epoch ms (as main: last time we successfully sent)
let _syncOk = false; // last sync attempt succeeded?
// callbacks injected from server.ts
let _getState = null;
let _applyState = null;
// ─── Helpers ─────────────────────────────────────────────────────────────────
async function pushStateToBackup() {
    if (!_backupUrl || !_getState)
        return;
    try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), SYNC_TIMEOUT);
        const res = await fetch(`${_backupUrl}/api/backup/sync`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(_getState()),
            signal: ctrl.signal,
        });
        clearTimeout(t);
        _syncOk = res.ok;
        if (res.ok)
            _lastSendAt = Date.now();
    }
    catch {
        _syncOk = false;
    }
}
function startSyncInterval() {
    if (_syncInterval)
        clearInterval(_syncInterval);
    _syncInterval = setInterval(pushStateToBackup, SYNC_INTERVAL);
    // push immediately
    pushStateToBackup();
}
function stopSyncInterval() {
    if (_syncInterval) {
        clearInterval(_syncInterval);
        _syncInterval = null;
    }
}
// ─── Public API ──────────────────────────────────────────────────────────────
function getBackupStatus() {
    return {
        role: _role,
        backupUrl: _backupUrl,
        lastSendAt: _lastSendAt,
        lastSyncAt: _lastSyncAt,
        syncOk: _syncOk,
        hasState: !!_cachedState,
    };
}
function setupBackupRoutes(app, io, getState, applyState) {
    _getState = getState;
    _applyState = applyState;
    // ── GET /api/backup/status ─────────────────────────────────────────────────
    app.get("/api/backup/status", (_, res) => {
        res.json(getBackupStatus());
    });
    // ── GET /api/backup/config ─────────────────────────────────────────────────
    app.get("/api/backup/config", (_, res) => {
        res.json({ role: _role, backupUrl: _backupUrl });
    });
    // ── POST /api/backup/config ────────────────────────────────────────────────
    // Body: { role?: "main"|"backup", backupUrl?: string }
    app.post("/api/backup/config", (req, res) => {
        const { role, backupUrl } = req.body;
        if (backupUrl !== undefined)
            _backupUrl = backupUrl || null;
        if (role && role !== _role) {
            _role = role;
            if (_role === "main" && _backupUrl) {
                startSyncInterval();
                // Tell connected clients about new backup URL
                io.emit("backup:config", { backupUrl: _backupUrl });
            }
            else {
                stopSyncInterval();
            }
        }
        else if (_role === "main" && _backupUrl) {
            // backupUrl changed while staying main → restart sync + re-notify clients
            startSyncInterval();
            io.emit("backup:config", { backupUrl: _backupUrl });
        }
        res.json({ ok: true });
    });
    // ── POST /api/backup/sync ──────────────────────────────────────────────────
    // Called by main server every SYNC_INTERVAL ms
    app.post("/api/backup/sync", (req, res) => {
        if (_role !== "backup") {
            // Accept and silently ignore if we've already taken over as main
            return res.json({ ok: false, reason: "not in backup role" });
        }
        _cachedState = req.body;
        _lastSyncAt = Date.now();
        res.json({ ok: true });
    });
    // ── POST /api/backup/takeover ──────────────────────────────────────────────
    // Operator presses TAKE OVER on the backup host UI
    app.post("/api/backup/takeover", (req, res) => {
        if (_role !== "backup") {
            return res.status(400).json({ ok: false, reason: "not in backup role" });
        }
        if (!_cachedState) {
            return res.status(400).json({ ok: false, reason: "no state received from main yet" });
        }
        console.log("[backup] TAKEOVER — applying cached state and becoming main");
        // Apply the last known state from main
        _applyState(_cachedState, io);
        // Switch role to main
        _role = "main";
        _backupUrl = null; // old main is gone
        // Tell all connected clients that this is now the main server
        // Clients receive this and update their stored server URL
        io.emit("host:relocated", { url: null });
        res.json({ ok: true });
    });
    // ── POST /api/backup/push-backup-url ──────────────────────────────────────
    // Force-push backup URL to all currently connected clients (idempotent)
    app.post("/api/backup/push-backup-url", (_, res) => {
        if (_backupUrl)
            io.emit("backup:config", { backupUrl: _backupUrl });
        res.json({ ok: true, url: _backupUrl });
    });
}
// Called from signaling.ts after a client connects — tells them the backup URL
function emitBackupConfig(socket) {
    if (_backupUrl)
        socket.emit("backup:config", { backupUrl: _backupUrl });
}
//# sourceMappingURL=backup.js.map