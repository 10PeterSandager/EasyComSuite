"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.streamDeckManager = exports.StreamDeckManager = void 0;
exports.getDebugState = getDebugState;
exports.clearAllConnections = clearAllConnections;
exports.factoryReset = factoryReset;
exports.setupSignaling = setupSignaling;
const os_1 = __importDefault(require("os"));
const mediasoup_1 = require("./mediasoup");
const audioOutput_1 = require("./audioOutput");
const tunnel_1 = require("./tunnel");
const persist_1 = require("./persist");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
// ── .env persistence ────────────────────────────────────────────────────────
// Reads the current .env, updates specific keys, and writes it back so
// settings survive a server restart.
function persistEnvVars(vars) {
    const envPath = path_1.default.resolve(process.cwd(), ".env");
    let content = "";
    try {
        content = fs_1.default.readFileSync(envPath, "utf8");
    }
    catch { /* file may not exist yet */ }
    for (const [key, value] of Object.entries(vars)) {
        const pattern = new RegExp(`^(#\\s*)?${key}=.*$`, "m");
        const line = `${key}=${value}`;
        if (pattern.test(content)) {
            // Replace existing line (even if commented out)
            content = content.replace(pattern, line);
        }
        else {
            content = content.trimEnd() + `\n${line}\n`;
        }
    }
    try {
        fs_1.default.writeFileSync(envPath, content, "utf8");
    }
    catch (e) {
        console.warn("[signaling] Could not write .env:", e);
    }
}
const connections = new Map();
const clients = new Map();
const terminals = new Map();
// Tracks the timestamp of the last disconnect for each clientId.
// Used by the grace-period timer to avoid premature connection cleanup when a
// client disconnects, reconnects, then disconnects again before the first timer fires.
const disconnectTimes = new Map();
// Preserves client data (incl. PIN code) during the 8-second grace period so
// client:auth can still verify the PIN before client:register fires.
const offlineClients = new Map();
const directVideoOffers = new Map(); // cache: sourceId → sdp
const producers = new Map();
const videoProducers = new Map(); // clientId → videoProducerId
const videoRouting = new Map(); // clientId → videoSources array
const groups = [];
const audioRoutes = new Map();
const producerTalkSessions = new Map();
// Per-client visibility whitelist: clientId → allowed peer IDs (empty array = all allowed)
const clientVisibility = new Map();
let bridgeChannelInfo = [];
const producerOutputs = new Map();
// Set of bridge channel numbers that are OUTPUTS (hardware outputs on the interface).
// Populated when the host sends audio:bridge:channelInfo:set.
const outputBridgeChannels = new Set();
(function restoreState() {
    const s = (0, persist_1.loadState)();
    s.connections.forEach(c => connections.set(connKey(c), c));
    s.groups.forEach(g => groups.push(g));
    s.clients.forEach(({ id, data }) => clients.set(id, { socketId: "", data: { ...data, status: "offline" } }));
    s.audioRoutes.forEach(r => audioRoutes.set(`${r.deviceId}-${r.channel}`, r));
    s.terminals?.forEach(t => terminals.set(t.id, t));
    s.videoRouting?.forEach(({ clientId, sources }) => videoRouting.set(clientId, sources));
    bridgeChannelInfo = s.bridgeChannelInfo;
    s.outputBridgeChannels.forEach(ch => outputBridgeChannels.add(ch));
    if (s.connections.length > 0)
        console.log(`[persist] restored ${s.connections.length} connections, ${s.groups.length} groups, ${s.clients.length} clients, ${terminals.size} terminals, ${videoRouting.size} videoRouting entries`);
})();
// Collects current state for saving to disk
function getPersistedState() {
    return {
        connections: Array.from(connections.values()),
        groups: [...groups],
        clients: Array.from(clients.entries())
            .filter(([, v]) => v.data && v.data.type !== "mobile" && v.data.type !== "remote" && v.data.type !== "desktop")
            .map(([id, v]) => ({ id, data: v.data })),
        audioRoutes: Array.from(audioRoutes.values()),
        bridgeChannelInfo: bridgeChannelInfo,
        outputBridgeChannels: Array.from(outputBridgeChannels),
        streamDeckLayout: exports.streamDeckManager.getCurrentLayout?.() ?? [],
        terminals: Array.from(terminals.values()),
        videoRouting: Array.from(videoRouting.entries()).map(([clientId, sources]) => ({ clientId, sources })),
    };
}
function save() { (0, persist_1.scheduleSave)(getPersistedState); }
function broadcastTerminals(io) {
    const list = Array.from(terminals.values()).map(t => ({
        ...t,
        connected: !!(t.pairedClientId && (() => {
            const c = clients.get(t.pairedClientId);
            return c?.socketId ? !!io.sockets.sockets.get(c.socketId)?.connected : false;
        })())
    }));
    io.emit("terminals:update", list);
}
// Keys of currently active server-side output routes ("clientId:chN").
// Used to diff against effective connections each routing cycle.
const activeOutputKeys = new Set();
// Tracks which TB channels are currently active (pressed/latched) per mobile client.
// Connections with toChannel are only included in routing when that channel is active.
const mobileActiveTb = new Map();
function connKey(c) {
    return c.toChannel != null
        ? `${c.from}-${c.to}-${c.channel}-tc${c.toChannel}`
        : `${c.from}-${c.to}-${c.channel}`;
}
function getConnectionsArray() { return Array.from(connections.values()); }
function getDebugState() {
    const allConns = Array.from(connections.values());
    const effectiveConns = getEffectiveConnections();
    const effectiveKeys = new Set(effectiveConns.map(c => connKey(c)));
    return {
        timestamp: new Date().toISOString(),
        connections: allConns.map(c => ({
            from: c.from, to: c.to, channel: c.channel,
            toChannel: c.toChannel ?? null,
            effective: effectiveKeys.has(connKey(c))
        })),
        producers: Array.from(producers.entries()).map(([id, producerId]) => ({ id, producerId })),
        clients: Array.from(clients.entries()).map(([id, c]) => ({
            id, socketId: c.socketId,
            name: c.data?.name ?? id,
            type: c.data?.type ?? "?",
            status: c.data?.status ?? "?"
        })),
        mobileActiveTb: Array.from(mobileActiveTb.entries()).map(([clientId, ch]) => ({
            clientId, activeChannels: Array.from(ch)
        })),
        stats: {
            totalConnections: allConns.length,
            effectiveConnections: effectiveConns.length,
            suppressedConnections: allConns.length - effectiveConns.length,
            producers: producers.size,
            clients: clients.size,
            mobilesTransmitting: Array.from(mobileActiveTb.values()).filter(s => s.size > 0).length
        }
    };
}
// Returns the subset of connections that should be active in routing right now.
// Connections without toChannel are always included (host ProducerStrip, bridge, etc).
// Connections with toChannel are only included when the source has that TB channel active.
// Non-mobile sources (not tracked in mobileActiveTb) are always included.
// Sidetone suppression: when a mobile client is transmitting (any TB channel active),
// the producer-65→client return path is blocked to prevent acoustic feedback through HOST speakers.
function getEffectiveConnections() {
    return Array.from(connections.values()).filter(c => {
        if (c.toChannel === undefined || c.toChannel === null) {
            // Block producer-65→client while that client is transmitting (sidetone suppression)
            // Block producer-65 when no mic is registered (prevents zombie-producer PLC noise)
            if (c.from === "producer-65" && !producers.has("producer-65"))
                return false;
            // Full sidetone suppression: block ALL incoming paths to a mobile while it's
            // transmitting. This prevents the phone hearing its own voice via any route
            // (HOST mic, bridge channels, other participants) regardless of hardware setup.
            if (mobileActiveTb.has(c.to)) {
                const activeTb = mobileActiveTb.get(c.to);
                if (activeTb && activeTb.size > 0)
                    return false;
            }
            return true;
        }
        if (!mobileActiveTb.has(c.from)) {
            // Source has no mobileActiveTb entry — either never registered or currently in the
            // 8-second disconnect grace period. Don't allow TB-gated connections to become
            // effective during the grace period (prevents routing 1→0→1 cycling that causes
            // repeated consumer creation and jitter-buffer artifacts on the HOST).
            return false;
        }
        return mobileActiveTb.get(c.from).has(c.toChannel);
    });
}
// 🔥 Debounced routing broadcast – forhindrer 64 broadcasts ved batch-registrering
let routingBroadcastTimer = null;
function broadcastRouting(io) {
    if (routingBroadcastTimer)
        clearTimeout(routingBroadcastTimer);
    routingBroadcastTimer = setTimeout(() => {
        const conns = getEffectiveConnections();
        console.log(`[signaling] routing broadcast: ${conns.length} effective / ${connections.size} total`);
        if (conns.length > 0)
            console.log(`[signaling] effective:`, JSON.stringify(conns));
        else if (connections.size > 0)
            console.log(`[signaling] all blocked by TB gating – stored:`, JSON.stringify(Array.from(connections.values())));
        io.emit("routing:update", conns);
        io.emit("connections:all", getConnectionsArray());
        routingBroadcastTimer = null;
        // ── Server-side audio output routing ──
        // For every effective connection whose destination is a hardware output channel,
        // consume the source producer on the server and play it to the soundcard.
        const currentOutputKeys = new Map();
        for (const conn of conns) {
            const m = conn.to.match(/^bridge-ch(\d+)$/);
            if (!m)
                continue;
            const hwCh = parseInt(m[1]);
            if (!outputBridgeChannels.has(hwCh))
                continue;
            const producerId = producers.get(conn.from);
            if (!producerId)
                continue;
            const key = `${conn.from}:ch${hwCh}`;
            currentOutputKeys.set(key, { clientId: conn.from, hwCh, producerId });
        }
        // Start newly active output routes
        for (const [key, { clientId, hwCh, producerId }] of currentOutputKeys) {
            if (!activeOutputKeys.has(key)) {
                activeOutputKeys.add(key);
                (0, audioOutput_1.startOutputRoute)(clientId, producerId, hwCh)
                    .catch(e => console.error("[signaling] startOutputRoute error:", e));
            }
        }
        // Stop routes that are no longer in effective connections
        for (const key of [...activeOutputKeys]) {
            if (!currentOutputKeys.has(key)) {
                activeOutputKeys.delete(key);
                const colonIdx = key.lastIndexOf(":ch");
                const clientId = key.slice(0, colonIdx);
                const hwCh = parseInt(key.slice(colonIdx + 3));
                (0, audioOutput_1.stopOutputRoute)(clientId, hwCh)
                    .catch(e => console.error("[signaling] stopOutputRoute error:", e));
            }
        }
    }, 100);
}
function clearAllConnections(io) {
    connections.clear();
    mobileActiveTb.clear();
    // Remove all dynamically-created clients (timestamp-format IDs like client-1234567890-0)
    const ghostIds = [];
    for (const [id] of clients.entries()) {
        if (/^client-\d{10,}-\d+$/.test(id))
            ghostIds.push(id);
    }
    ghostIds.forEach(id => clients.delete(id));
    if (ghostIds.length > 0)
        console.log(`[signaling] removed ghost clients: ${ghostIds.join(", ")}`);
    io.emit("connections:all", []);
    io.emit("routing:update", []);
    io.emit("clients:update", {});
    console.log("[signaling] all connections + ghost clients cleared via admin endpoint");
}
function factoryReset(io) {
    connections.clear();
    groups.splice(0, groups.length);
    clients.clear();
    audioRoutes.clear();
    bridgeChannelInfo = [];
    outputBridgeChannels.clear();
    mobileActiveTb.clear();
    producers.clear();
    terminals.clear();
    (0, persist_1.scheduleSave)(() => ({
        connections: [], groups: [], clients: [],
        audioRoutes: [], bridgeChannelInfo: [], outputBridgeChannels: [], streamDeckLayout: [],
        terminals: [], videoRouting: [],
    }));
    io.emit("connections:all", []);
    io.emit("routing:update", []);
    io.emit("clients:update", {});
    io.emit("groups:update", []);
    io.emit("factory:reset");
    console.log("[signaling] ⚠️  Factory reset — all state cleared");
}
function setupSignaling(io) {
    // Queue for consume:requests that arrive before the producer is registered.
    // Key = targetId, fulfilled when producer:register fires for that clientId.
    const pendingConsumeQueue = new Map();
    io.on("connection", (socket) => {
        /* ---------- REGISTER ---------- */
        socket.on("client:register", (client, cb) => {
            // Cancel any pending grace-period cleanup for this client
            disconnectTimes.delete(client.id);
            offlineClients.delete(client.id);
            if (client.type === "mobile" || client.type === "remote" || client.type === "desktop") {
                // Track TB gating state for this mobile/remote (empty = no TB pressed)
                if (!mobileActiveTb.has(client.id))
                    mobileActiveTb.set(client.id, new Set());
                // Send eksisterende video producers til ny mobil client
                for (const [sourceId, producerId] of videoProducers.entries()) {
                    socket.emit("video:producer:available", { clientId: sourceId, producerId });
                }
                // 🔥 Send video routing til ny client
                const clientVideoSources = videoRouting.get(client.id) || [];
                if (clientVideoSources.length > 0) {
                    socket.emit("video:routing:update", { videoSources: clientVideoSources });
                }
                // Fortæl ny client om tilgængelige bridge-kanaler (ingen auto-routing)
                const bridgeChs = Array.from(producers.keys()).filter(k => k.startsWith("bridge-ch"));
                if (bridgeChs.length > 0) {
                    socket.emit("bridge:channels:available", bridgeChs.map(bch => ({
                        clientId: bch,
                        channel: parseInt(bch.replace("bridge-ch", ""))
                    })));
                }
                // 🔥 Send eksisterende stereo-producere til ny client
                // (bridge:stereo:available broadcastes kun ved registrering – nye clients misser det)
                const stereoChs = Array.from(producers.keys()).filter(k => k.startsWith("bridge-stereo-"));
                for (const stereoId of stereoChs) {
                    const match = stereoId.match(/bridge-stereo-(\d+)-(\d+)/);
                    if (match) {
                        socket.emit("bridge:stereo:available", {
                            chL: parseInt(match[1]),
                            chR: parseInt(match[2]),
                            stereoId
                        });
                    }
                }
            }
            const existing = clients.get(client.id);
            // Host batch-registration always sends type:"" — keep offline, just sync name/code.
            if (client.type === "") {
                if (existing) {
                    clients.set(client.id, { socketId: "", data: { ...existing.data, name: client.name, code: client.code } });
                }
                else {
                    clients.set(client.id, { socketId: "", data: { ...client, status: "offline" } });
                }
                io.emit("clients:update", { id: client.id, updates: { name: client.name, code: client.code } });
                cb?.({ ok: true });
                return;
            }
            if (existing && existing.socketId !== socket.id && client.type !== "mobile" && client.type !== "remote" && client.type !== "desktop") {
                // Tjek om den eksisterende socket stadig er connected
                // Kun relevant for ikke-mobile clients: forhindrer host-appens batch-re-registrering
                // fra at overskrive en allerede connected mobil.
                // Mobile clients SKAL altid opdatere socketId, da de er det rigtige bruger-device.
                const existingSocket = io.sockets.sockets.get(existing.socketId);
                if (existingSocket && existingSocket.connected) {
                    clients.set(client.id, {
                        socketId: existing.socketId,
                        data: { ...existing.data, ...client }
                    });
                    socket.clientId = client.id;
                    io.emit("clients:update", { id: client.id, updates: client });
                    cb?.({ ok: true });
                    return;
                }
            }
            clients.set(client.id, { socketId: socket.id, data: client });
            socket.clientId = client.id;
            io.emit("clients:update", { id: client.id, updates: { ...client, status: "online" } });
            save();
            cb?.({ ok: true });
            // Auto-create TB return so the host can consume the phone's mic when TB1 is pressed.
            // IFB (bridge → client) is NOT auto-created — set it up via ConnectionsPopup for a clean slate.
            if (client.type === "mobile" || client.type === "remote" || client.type === "desktop") {
                const tbReturnKey = connKey({ from: client.id, to: "producer-65", channel: 1, toChannel: 1 });
                if (!connections.has(tbReturnKey)) {
                    connections.set(tbReturnKey, { from: client.id, to: "producer-65", channel: 1, toChannel: 1 });
                    console.log(`[signaling] auto TB return: ${client.id} → producer-65 ch1 (TB1-gated)`);
                }
                broadcastRouting(io);
            }
            // Always send current routing to mobile/remote clients on register.
            // Covers both first-time connect and socket.io auto-reconnects where the
            // server deleted the client entry on disconnect (so `existing` is always null).
            if (client.type === "mobile" || client.type === "remote" || client.type === "desktop") {
                const conns = getEffectiveConnections();
                socket.emit("routing:update", conns);
                console.log(`[signaling] routing sent to "${client.id}" on register: ${conns.length} connections`);
            }
        });
        socket.on("client:auth", ({ clientId, code }, cb) => {
            const clientData = clients.get(clientId)?.data ?? offlineClients.get(clientId);
            const storedCode = clientData?.code || "0000";
            const ok = code === storedCode;
            console.log(`[signaling] auth ${clientId}: ${ok ? '✅' : '❌'} (entered: ${code}, stored: ${storedCode})`);
            cb?.({ ok });
        });
        socket.on("client:update", ({ id, updates }, cb) => {
            const existing = clients.get(id);
            if (existing)
                clients.set(id, { ...existing, data: { ...(existing.data || {}), ...updates } });
            io.emit("clients:update", { id, updates });
            cb?.({ ok: true });
        });
        socket.on("clients:list", (cb) => {
            if (typeof cb !== "function")
                return;
            const list = Array.from(clients.values()).map(c => ({
                id: c.data?.id || "",
                name: c.data?.name || "",
                type: c.data?.type || "",
                code: c.data?.code || "0000",
                status: c.data?.status || "online",
                color: c.data?.color || undefined,
            })).filter(c => c.id !== "" && c.id !== "host-ui");
            // Find the requesting client (not host-ui)
            const callerId = [...clients.entries()]
                .find(([, c]) => c.socketId === socket.id && c.data?.id !== "host-ui")?.[0];
            if (callerId) {
                const allowed = clientVisibility.get(callerId);
                if (allowed && allowed.length > 0) {
                    return cb(list.filter(c => allowed.includes(c.id)));
                }
            }
            cb(list);
        });
        socket.on("producer:closed", ({ clientId, producerId }) => {
            console.log(`[signaling] producer closed: ${clientId} → ${producerId}`);
            // Remove from app-level map so consume:request returns "no producer" instead of
            // successfully creating a consumer on a zombie producer (which generates PLC noise).
            producers.delete(clientId);
            // Close the mediasoup server-side producer so its consumers get a producerclose event
            // and RTP stops flowing immediately rather than lingering as a silent zombie.
            try {
                (0, mediasoup_1.getProducer)(producerId)?.close();
            }
            catch { }
            // Notify all consuming clients (phone closes its consumer)
            io.emit("producer:closed", { clientId, producerId });
            // Rebroadcast routing so clients stop trying to consume the now-dead producer
            broadcastRouting(io);
        });
        // 🔥 Bridge-kanaler registreres og routes automatisk til alle tilsluttede clients
        socket.on("bridge:producer:register", ({ channel, producerId }) => {
            const clientId = `bridge-ch${channel}`;
            producers.set(clientId, producerId);
            console.log(`[signaling] bridge producer registered: ${clientId} → ${producerId}`);
            // Flush any consume:requests that arrived before this producer was ready
            const pending = pendingConsumeQueue.get(clientId);
            if (pending?.length) {
                pendingConsumeQueue.delete(clientId);
                console.log(`[signaling] fulfilling ${pending.length} queued consume:request(s) for "${clientId}"`);
                for (const req of pending) {
                    clearTimeout(req.timer);
                    (0, mediasoup_1.consume)(req.transportId, producerId, req.rtpCapabilities)
                        .then(async (consumer) => {
                        if (consumer.kind === 'audio')
                            await consumer.resume();
                        req.cb?.({ producerId, id: consumer.id, kind: consumer.kind, rtpParameters: consumer.rtpParameters });
                    })
                        .catch(e => req.cb?.({ error: String(e) }));
                }
            }
        });
        socket.on("bridge:stereo:register", ({ chL, chR, producerId }) => {
            const stereoId = `bridge-stereo-${chL}-${chR}`;
            producers.set(stereoId, producerId);
            console.log(`[signaling] stereo bridge registered: ${stereoId} → ${producerId}`);
            io.emit("bridge:stereo:available", { chL, chR, stereoId });
            // Fulfill any consume:requests that arrived before this stereo producer was ready
            const pending = pendingConsumeQueue.get(stereoId);
            if (pending?.length) {
                pendingConsumeQueue.delete(stereoId);
                console.log(`[signaling] fulfilling ${pending.length} queued consume:request(s) for "${stereoId}"`);
                for (const req of pending) {
                    clearTimeout(req.timer);
                    (0, mediasoup_1.consume)(req.transportId, producerId, req.rtpCapabilities)
                        .then(async (consumer) => {
                        if (consumer.kind === 'audio')
                            await consumer.resume();
                        req.cb?.({ producerId, id: consumer.id, kind: consumer.kind, rtpParameters: consumer.rtpParameters });
                    })
                        .catch(e => req.cb?.({ error: String(e) }));
                }
            }
        });
        socket.on("bridge:producers:done", () => {
            const bridgeChannels = Array.from(producers.keys()).filter(k => k.startsWith("bridge-ch"));
            console.log(`[signaling] ✅ ${bridgeChannels.length} bridge producers klar og tilgængelige`);
            // Broadcast tilgængelige bridge-kanaler til alle clients
            io.emit("bridge:channels:available", bridgeChannels.map(bch => ({
                clientId: bch,
                channel: parseInt(bch.replace("bridge-ch", ""))
            })));
            // Default IFB slot 1: bridge-ch1 → all registered mobile clients (first-time setup).
            // Only applies the default if no IFB routing exists yet for slot 1.
            const bchDefault = "bridge-ch1";
            if (producers.has(bchDefault)) {
                const mobileIds = Array.from(clients.entries())
                    .filter(([, c]) => c.data?.type === "mobile" || c.data?.type === "remote" || c.data?.type === "desktop")
                    .map(([id]) => id);
                const alreadyRouted = mobileIds.some(id => connections.has(connKey({ from: bchDefault, to: id, channel: 1 })));
                if (!alreadyRouted && mobileIds.length > 0) {
                    for (const mobileId of mobileIds) {
                        const k = connKey({ from: bchDefault, to: mobileId, channel: 1 });
                        connections.set(k, { from: bchDefault, to: mobileId, channel: 1 });
                    }
                    broadcastRouting(io);
                    console.log(`[signaling] default IFB: bridge-ch1 → ${mobileIds.length} client(s)`);
                }
            }
            // 🔥 Emit producer:ready for each bridge channel
            // Så mobiler der allerede har en routing til en bridge-kanal kan re-consume
            for (const bch of bridgeChannels) {
                io.emit("producer:ready", { clientId: bch });
            }
        });
        // HOST sets which bridge channel feeds IFB slot N for all mobile clients.
        // Replaces any previous bridge-ch connection on the same slot channel.
        socket.on("bridge:ifb:set", ({ channel, slot = 1 }) => {
            const bch = `bridge-ch${channel}`;
            if (!producers.has(bch)) {
                console.warn(`[signaling] bridge:ifb:set – ${bch} not found in producers`);
                return;
            }
            // Remove ALL bridge-ch → mobile connections on this IFB slot
            for (const [key, conn] of connections.entries()) {
                if (conn.from.startsWith("bridge-ch") && conn.channel === slot) {
                    connections.delete(key);
                }
            }
            // Create bridge-ch[N] → every mobile/remote client, channel: slot
            const mobileIds = Array.from(clients.entries())
                .filter(([, c]) => c.data?.type === "mobile" || c.data?.type === "remote" || c.data?.type === "desktop")
                .map(([id]) => id);
            for (const mobileId of mobileIds) {
                const k = connKey({ from: bch, to: mobileId, channel: slot });
                connections.set(k, { from: bch, to: mobileId, channel: slot });
            }
            broadcastRouting(io);
            save();
            console.log(`[signaling] IFB slot${slot} → ${bch} for ${mobileIds.length} client(s)`);
        });
        socket.on("producer:register", ({ clientId, producerId, kind = "audio" }) => {
            if (kind === "video") {
                videoProducers.set(clientId, producerId);
                console.log(`[signaling] VIDEO producer registered: ${clientId} → ${producerId}`);
                // Notify clients that have this clientId in their videoSources
                io.emit("video:producer:available", { clientId, producerId });
            }
            else {
                producers.set(clientId, producerId);
                console.log(`[signaling] producer registered: ${clientId} → ${producerId}`);
                io.emit("producer:ready", { clientId, producerId });
                // Fulfill any consume:requests that arrived before this producer was ready
                const pending = pendingConsumeQueue.get(clientId);
                if (pending?.length) {
                    pendingConsumeQueue.delete(clientId);
                    console.log(`[signaling] fulfilling ${pending.length} queued consume:request(s) for "${clientId}"`);
                    for (const req of pending) {
                        clearTimeout(req.timer);
                        (0, mediasoup_1.consume)(req.transportId, producerId, req.rtpCapabilities)
                            .then(async (consumer) => {
                            if (consumer.kind === 'audio')
                                await consumer.resume();
                            req.cb?.({ producerId, id: consumer.id, kind: consumer.kind, rtpParameters: consumer.rtpParameters });
                        })
                            .catch(e => req.cb?.({ error: String(e) }));
                    }
                }
            }
            broadcastRouting(io);
        });
        socket.on("video:routing:update", ({ clientId, videoSources }) => {
            const prevSources = videoRouting.get(clientId) || [];
            videoRouting.set(clientId, videoSources);
            save();
            console.log(`[signaling] video routing: ${clientId} → sources [${videoSources}] (prev: [${prevSources}])`);
            // Find mobilens socket via clients map (ikke socket-attributten som er undefined)
            const mobileEntry = clients.get(clientId);
            // Tjek om stored socketId stadig er en aktiv socket (undgå stale IDs)
            const storedSocket = mobileEntry ? io.sockets.sockets.get(mobileEntry.socketId) : null;
            const mobileSocket = storedSocket ?? null;
            console.log(`[signaling] socket for ${clientId}: ${mobileSocket?.id ?? 'IKKE FUNDET (stale socketId: ' + mobileEntry?.socketId + ')'}`);
            if (mobileSocket) {
                // Send routing til mobilen
                mobileSocket.emit("video:routing:update", { videoSources });
                // 🔥 Bed host om at sende friske offers for ændret routing
                const hostClient = clients.get("host-ui");
                if (hostClient) {
                    // Nye sources = sources der er tilføjet (ikke-nul i ny men ikke i prev)
                    const prevActive = prevSources.filter(s => s > 0);
                    const newActive = videoSources.filter(s => s > 0);
                    const newSources = newActive.filter(s => !prevActive.includes(s));
                    const removedSources = prevActive.filter(s => !newActive.includes(s));
                    if (newSources.length > 0) {
                        io.to(hostClient.socketId).emit("video:direct:request-from-client", {
                            toSocketId: mobileSocket.id,
                            clientId
                        });
                        console.log(`[signaling] → host: send offers til ${mobileSocket.id} for ${clientId}`);
                    }
                    if (removedSources.length > 0) {
                        removedSources.forEach(src => {
                            // Find slot i det forrige array
                            const slotIdx = prevSources.indexOf(src);
                            const slot = slotIdx >= 0 ? slotIdx + 1 : (src <= 1 ? 1 : 2);
                            // Only clear if the slot is truly going OFF – not if it's just switching to a different source
                            if ((videoSources[slotIdx] ?? 0) === 0) {
                                mobileSocket.emit("video:routing:cleared", { slot });
                                console.log(`[signaling] video source ${src} fjernet fra slot ${slot} for ${clientId}`);
                            }
                            else {
                                console.log(`[signaling] video source ${src} skiftet til ${videoSources[slotIdx]} på slot ${slot} for ${clientId} – ingen cleared sendt`);
                            }
                        });
                    }
                    if (newActive.length === 0 && prevActive.length > 0) {
                        mobileSocket.emit("video:routing:cleared", { slot: 1 });
                        mobileSocket.emit("video:routing:cleared", { slot: 2 });
                    }
                }
            }
        });
        socket.on("consume:request:video", ({ targetId, rtpCapabilities, transportId }, cb) => {
            const producerId = videoProducers.get(targetId);
            if (!producerId) {
                cb?.({ error: "no video producer for " + targetId });
                return;
            }
            // Brug samme mediasoup consumer logik
            socket.emit("consume:request", { targetId, rtpCapabilities, transportId }, cb);
        });
        /* ---------- GROUPS ---------- */
        socket.on("group:create", (group, cb) => {
            const idx = groups.findIndex(g => g.id === group.id);
            if (idx >= 0)
                groups[idx] = group;
            else
                groups.push(group);
            save();
            cb?.({ ok: true });
        });
        socket.on("group:list", (cb) => { if (typeof cb === "function")
            cb(groups); });
        socket.on("group:delete", ({ id }, cb) => {
            const idx = groups.findIndex(g => g.id === id);
            if (idx >= 0) {
                const group = groups[idx];
                for (const [k, c] of connections) {
                    if (group.members.includes(c.from) && group.members.includes(c.to)) {
                        connections.delete(k);
                    }
                }
                groups.splice(idx, 1);
                broadcastRouting(io);
            }
            save();
            cb?.({ ok: true });
        });
        /* ---------- CONNECTIONS ---------- */
        socket.on("connection:create", (data, cb) => {
            const { from, to, channel, isGroup, replace, toChannel, bidirectional = true } = data;
            if (from === to) {
                cb?.({ ok: false, error: "self route blocked" });
                return;
            }
            if (replace) {
                for (const [k, c] of connections) {
                    if ((c.from === from && c.to === to) || (c.from === to && c.to === from)) {
                        connections.delete(k);
                    }
                }
            }
            const add = (a, b) => {
                const c1 = { from: a, to: b, channel, toChannel };
                if (!connections.has(connKey(c1)))
                    connections.set(connKey(c1), c1);
                if (bidirectional) {
                    const c2 = { from: b, to: a, channel: toChannel ?? channel, toChannel: toChannel ? channel : undefined };
                    if (!connections.has(connKey(c2)))
                        connections.set(connKey(c2), c2);
                }
            };
            if (isGroup) {
                const group = groups.find(g => g.id === to);
                if (!group) {
                    cb?.({ ok: false });
                    return;
                }
                group.members.forEach(member => { if (member !== from)
                    add(from, member); });
            }
            else {
                add(from, to);
            }
            broadcastRouting(io);
            save();
            cb?.({ ok: true });
        });
        socket.on("connection:remove", ({ from, to, channel, toChannel, bidirectional = true }) => {
            // Delete matching connections — check both TB-gated and non-TB variants
            for (const [k, c] of connections.entries()) {
                const matchFwd = c.from === from && c.to === to && c.channel === channel &&
                    (toChannel == null || c.toChannel === toChannel);
                const matchRev = bidirectional && c.from === to && c.to === from && c.channel === channel;
                if (matchFwd || matchRev)
                    connections.delete(k);
            }
            broadcastRouting(io);
            save();
        });
        socket.on("connections:list", (cb) => {
            if (typeof cb === "function")
                cb(getConnectionsArray());
        });
        socket.on("routing:request:all", () => {
            socket.emit("routing:update", getEffectiveConnections());
        });
        socket.on("connections:request:all", () => {
            socket.emit("connections:all", getConnectionsArray());
        });
        socket.on("routing:request", (clientId, cb) => {
            const routing = {};
            for (const c of getEffectiveConnections()) {
                if (c.to !== clientId)
                    continue;
                if (!routing[c.channel])
                    routing[c.channel] = [];
                routing[c.channel].push(c.from);
            }
            if (typeof cb === "function")
                cb(routing);
        });
        /* ---------- PRODUCER TALK ---------- */
        socket.on("producer:talk:start", ({ producerId, targetId, inputDeviceId, inputChannel }, cb) => {
            producerTalkSessions.set(`${producerId}-${targetId}`, { targetId, inputDeviceId, inputChannel: inputChannel ?? 1 });
            const target = clients.get(targetId);
            if (target)
                io.to(target.socketId).emit("producer:incoming", { producerId, inputDeviceId, inputChannel, active: true });
            cb?.({ ok: true });
        });
        socket.on("producer:talk:stop", ({ producerId, targetId }, cb) => {
            producerTalkSessions.delete(`${producerId}-${targetId}`);
            const target = clients.get(targetId);
            if (target)
                io.to(target.socketId).emit("producer:incoming", { producerId, active: false });
            cb?.({ ok: true });
        });
        socket.on("producer:output:set", ({ producerId, outputDeviceId, outputChannel }, cb) => {
            producerOutputs.set(producerId, { deviceId: outputDeviceId, channel: outputChannel ?? 1 });
            cb?.({ ok: true });
        });
        socket.on("producer:input:set", ({ deviceId, channel, label }, cb) => {
            const producer = clients.get("producer-65");
            if (producer)
                clients.set("producer-65", { ...producer, data: { ...(producer.data || {}), inputDeviceId: deviceId, inputChannel: channel, inputLabel: label } });
            cb?.({ ok: true });
        });
        socket.on("producer:input:clear", ({}, cb) => {
            const producer = clients.get("producer-65");
            if (producer)
                clients.set("producer-65", { ...producer, data: { ...(producer.data || {}), inputDeviceId: null, inputChannel: null } });
            cb?.({ ok: true });
        });
        /* ---------- IFB ---------- */
        socket.on("ifb:settings:update", ({ clientId, settings }, cb) => {
            const existing = clients.get(clientId);
            if (existing)
                clients.set(clientId, { ...existing, data: { ...(existing.data || {}), ifbSettings: settings } });
            cb?.({ ok: true });
        });
        socket.on("ifb:activate", ({ targetClientId, settings }, cb) => {
            const target = clients.get(targetClientId);
            if (target)
                io.to(target.socketId).emit("ifb:duck", { active: true, settings });
            cb?.({ ok: true });
        });
        socket.on("ifb:deactivate", ({ targetClientId }, cb) => {
            const target = clients.get(targetClientId);
            if (target)
                io.to(target.socketId).emit("ifb:duck", { active: false });
            cb?.({ ok: true });
        });
        socket.on("ifb:feed:volume", ({ clientId, sourceId, volume }) => {
            const target = clients.get(clientId);
            if (target)
                io.to(target.socketId).emit("ifb:feed:volume", { sourceId, volume });
        });
        /* ---------- TONE ---------- */
        socket.on("tone:start", ({ clientId, freq, wave, level, mode }) => {
            getConnectionsArray().filter(c => c.from === clientId).forEach(conn => {
                const target = clients.get(conn.to);
                if (target)
                    io.to(target.socketId).emit("tone:incoming", { from: clientId, freq, wave, level, channel: conn.channel, mode });
            });
        });
        socket.on("tone:update", ({ clientId, freq }) => {
            getConnectionsArray().filter(c => c.from === clientId).forEach(conn => {
                const target = clients.get(conn.to);
                if (target)
                    io.to(target.socketId).emit("tone:update", { from: clientId, freq });
            });
        });
        socket.on("tone:stop", ({ clientId }) => {
            getConnectionsArray().filter(c => c.from === clientId).forEach(conn => {
                const target = clients.get(conn.to);
                if (target)
                    io.to(target.socketId).emit("tone:stop", { from: clientId });
            });
        });
        /* ---------- AUDIO ---------- */
        socket.on("audio:route", (route, cb) => {
            audioRoutes.set(`${route.deviceId}-${route.channel}`, route);
            io.emit("audio:routes:update", Array.from(audioRoutes.values()));
            save();
            cb?.({ ok: true });
        });
        socket.on("audio:route:remove", ({ deviceId, channel }, cb) => {
            audioRoutes.delete(`${deviceId}-${channel}`);
            io.emit("audio:routes:update", Array.from(audioRoutes.values()));
            save();
            cb?.({ ok: true });
        });
        socket.on("audio:routes:list", (cb) => {
            if (typeof cb === "function")
                cb(Array.from(audioRoutes.values()));
        });
        /* ---------- VIDEO PRODUCERS REQUEST ---------- */
        socket.on("video:producers:request", (data, cb) => {
            const clientId = typeof data === 'string' ? data : data?.clientId;
            // Returner alle kendte video producers til client
            const prods = Array.from(videoProducers.entries()).map(([sourceId, producerId]) => ({ sourceId, producerId }));
            console.log(`[signaling] video:producers:request for "${clientId}": ${prods.length} producers`);
            cb?.(prods);
            // Emit event til client så de kan consume via normal flow
            prods.forEach(({ sourceId, producerId }) => {
                socket.emit("video:producer:available", { clientId: sourceId, producerId });
            });
            // Tjek også om client har specifik video routing
            const routing = videoRouting.get(clientId) || [];
            routing.forEach(src => {
                const hostClientId = `video-source-${src}`;
                const producerId = videoProducers.get(hostClientId);
                if (producerId)
                    socket.emit("video:producer:available", { clientId: hostClientId, producerId });
            });
        });
        /* ---------- BRIDGE CHANNEL INFO ---------- */
        socket.on("audio:bridge:channelInfo:set", (channelInfo) => {
            bridgeChannelInfo = channelInfo;
            outputBridgeChannels.clear();
            for (const ch of channelInfo) {
                if (ch.type === "output")
                    outputBridgeChannels.add(ch.channel);
            }
            console.log(`[signaling] output bridge channels: [${[...outputBridgeChannels]}]`);
            save();
        });
        /* ---------- SERVER-SIDE AUDIO OUTPUT ---------- */
        socket.on("output:devices:list", (cb) => {
            if (typeof cb !== "function")
                return;
            (0, audioOutput_1.listOutputDevices)(devices => cb(devices));
        });
        socket.on("output:channel:config", ({ hwChannel, deviceId, deviceChannels }, cb) => {
            (0, audioOutput_1.setChannelConfig)(hwChannel, { deviceId, deviceChannels });
            cb?.({ ok: true });
        });
        socket.on("audio:bridge:channelInfo", (cb) => {
            if (typeof cb === "function")
                cb(bridgeChannelInfo);
        });
        // 🔥 Relay gain from mobile client to host-ui
        socket.on("client:gain", ({ channel, gain }) => {
            const hostSocket = clients.get("host-ui")?.socketId;
            if (!hostSocket)
                return;
            const clientId = socket.clientId || socket.id;
            console.log(`[client:gain] socket.id=${socket.id} clientId=${clientId} channel=${channel}`);
            const conn = Array.from(connections.values()).find(c => c.to === clientId && c.channel === channel);
            const bridgeId = conn?.from ?? null;
            io.to(hostSocket).emit("client:gain", { clientId, channel, gain, bridgeId });
        });
        socket.on("audio:level", ({ clientId, level }) => {
            const update = { [clientId]: level };
            for (const conn of connections.values()) {
                if (conn.from === clientId)
                    update[`recv_${conn.to}`] = level;
            }
            io.emit("audio:levels", update);
        });
        // 🔥 Batched bridge levels – ét event for alle kanaler
        socket.on("bridge:levels", (levels) => {
            const update = {};
            for (const [clientId, level] of Object.entries(levels)) {
                update[clientId] = level;
                // Find alle connections fra denne bridge-kanal og sæt recv-niveauer
                for (const conn of connections.values()) {
                    if (conn.from === clientId)
                        update[`recv_${conn.to}`] = level;
                }
            }
            // Stereo-par sender ikke egne level-events — beregn niveau som max(chL, chR)
            for (const stereoId of producers.keys()) {
                const m = stereoId.match(/^bridge-stereo-(\d+)-(\d+)$/);
                if (!m)
                    continue;
                const lvL = levels[`bridge-ch${m[1]}`] ?? 0;
                const lvR = levels[`bridge-ch${m[2]}`] ?? 0;
                const stereoLevel = Math.max(lvL, lvR);
                if (stereoLevel <= 0)
                    continue;
                update[stereoId] = stereoLevel;
                for (const conn of connections.values()) {
                    if (conn.from === stereoId)
                        update[`recv_${conn.to}`] = stereoLevel;
                }
            }
            if (Object.keys(update).length > 0) {
                io.emit("audio:levels", update);
            }
        });
        /* ---------- MEDIASOUP ---------- */
        socket.on("mediasoup:getRouterRtpCapabilities", (cb) => {
            if (typeof cb === "function")
                cb(mediasoup_1.router.rtpCapabilities);
        });
        socket.on("mediasoup:createTransport", async ({ direction }, cb) => {
            try {
                const t = await (0, mediasoup_1.createTransport)(direction);
                if (typeof cb === "function")
                    cb({
                        id: t.id, iceParameters: t.iceParameters,
                        iceCandidates: t.iceCandidates, dtlsParameters: t.dtlsParameters
                    });
            }
            catch (e) {
                cb?.({ error: String(e) });
            }
        });
        socket.on("mediasoup:connectTransport", async ({ transportId, dtlsParameters }, cb) => {
            try {
                await (0, mediasoup_1.connectTransport)(transportId, dtlsParameters);
                if (typeof cb === "function")
                    cb();
            }
            catch (e) {
                cb?.({ error: String(e) });
            }
        });
        socket.on("mediasoup:produce", async ({ transportId, kind, rtpParameters }, cb) => {
            try {
                const p = await (0, mediasoup_1.produce)(transportId, kind, rtpParameters);
                if (typeof cb === "function")
                    cb({ id: p.id });
            }
            catch (e) {
                cb?.({ error: String(e) });
            }
        });
        socket.on("consume:request", async ({ targetId, rtpCapabilities, transportId, kind: reqKind }, cb) => {
            try {
                // Check both audio and video producers
                const producerId = reqKind === "video"
                    ? (videoProducers.get(targetId) || producers.get(targetId))
                    : (producers.get(targetId) || videoProducers.get(targetId));
                if (!producerId) {
                    if (reqKind !== "video") {
                        // Queue audio consume requests for up to 5 s — handles the race where
                        // connection:create arrives before producer:register (mic not yet started).
                        console.log(`[signaling] no producer for "${targetId}" – queuing consume:request (5 s)`);
                        const timer = setTimeout(() => {
                            const arr = pendingConsumeQueue.get(targetId);
                            if (arr) {
                                const i = arr.findIndex(r => r.transportId === transportId);
                                if (i >= 0) {
                                    arr.splice(i, 1);
                                    if (!arr.length)
                                        pendingConsumeQueue.delete(targetId);
                                }
                            }
                            cb?.({ error: "no producer (timeout)" });
                        }, 5000);
                        const arr = pendingConsumeQueue.get(targetId) ?? [];
                        arr.push({ transportId, rtpCapabilities, cb, kind: reqKind, timer });
                        pendingConsumeQueue.set(targetId, arr);
                        return;
                    }
                    console.log(`[signaling] no producer for "${targetId}" (audio: ${Array.from(producers.keys()).join(',')}, video: ${Array.from(videoProducers.keys()).join(',')})`);
                    if (typeof cb === "function")
                        cb({ error: "no producer" });
                    return;
                }
                const consumer = await (0, mediasoup_1.consume)(transportId, producerId, rtpCapabilities);
                // For audio: resume immediately. For video: wait for client ready signal
                if (consumer.kind === 'audio') {
                    await consumer.resume();
                    console.log(`[signaling] consumer resumed: ${consumer.id}`);
                }
                else {
                    console.log(`[signaling] video consumer created (paused, waiting for client ready): ${consumer.id}`);
                }
                if (typeof cb === "function")
                    cb({
                        producerId, id: consumer.id,
                        kind: consumer.kind, rtpParameters: consumer.rtpParameters
                    });
            }
            catch (e) {
                cb?.({ error: String(e) });
            }
        });
        // 🔥 Eksplicit resume endpoint hvis client kalder det
        socket.on("consumer:resume", async ({ consumerId }, cb) => {
            try {
                const { getConsumer } = await Promise.resolve().then(() => __importStar(require("./mediasoup")));
                const consumer = getConsumer(consumerId);
                if (!consumer) {
                    cb?.({ error: 'consumer not found' });
                    return;
                }
                if (consumer)
                    await consumer.resume();
                console.log(`[signaling] consumer resumed: ${consumerId} (kind: ${consumer.kind})`);
                // 🔥 For video: request keyframe so client gets a full frame immediately
                if (consumer.kind === 'video') {
                    try {
                        await consumer.requestKeyFrame();
                    }
                    catch { }
                }
                cb?.({ ok: true });
            }
            catch (e) {
                cb?.({ error: String(e) });
            }
        });
        socket.on("consumer:pause", async ({ consumerId }, cb) => {
            try {
                const { getConsumer } = await Promise.resolve().then(() => __importStar(require("./mediasoup")));
                const consumer = getConsumer(consumerId);
                if (!consumer) {
                    cb?.({ error: 'consumer not found' });
                    return;
                }
                await consumer.pause();
                console.log(`[signaling] consumer paused: ${consumerId} (kind: ${consumer.kind})`);
                cb?.({ ok: true });
            }
            catch (e) {
                cb?.({ error: String(e) });
            }
        });
        /* ---------- JPEG FRAME RELAY ---------- */
        socket.on("video:frame", ({ sourceId, dataUrl }) => {
            for (const [id, c] of clients.entries()) {
                if (id !== "host-ui") {
                    io.to(c.socketId).volatile.emit("video:frame", { sourceId, dataUrl });
                }
            }
        });
        /* ---------- DIRECT VIDEO (bypasser mediasoup for delivery) ---------- */
        // 🔥 WebCodecs chunks – relay fra host til alle mobile clients
        socket.on("video:chunk", ({ sourceId, data, type, timestamp }) => {
            for (const [id, c] of clients.entries()) {
                if (id !== "host-ui") {
                    io.to(c.socketId).emit("video:chunk", { sourceId, data, type, timestamp });
                }
            }
        });
        socket.on("video:direct:offer", ({ sourceId, sdp, toSocketId, slot }) => {
            if (toSocketId) {
                console.log(`[signaling] video:direct:offer for ${sourceId} → specifik socket ${toSocketId}`);
                io.to(toSocketId).emit("video:direct:offer", { sourceId, sdp, slot });
            }
            else {
                console.log(`[signaling] video:direct:offer for ${sourceId} – cacher + sender kun til klienter med routing`);
                directVideoOffers.set(sourceId, sdp);
                const srcNum = parseInt(sourceId.replace('video-source-', ''));
                for (const [id, c] of clients.entries()) {
                    if (id === "host-ui")
                        continue;
                    // 🔥 Send kun hvis klienten har denne source i sin routing
                    const clientSources = videoRouting.get(id);
                    if (clientSources === undefined) {
                        // Ingen routing sat endnu – send IKKE (routing skal sættes eksplicit)
                        console.log(`[signaling] ${id} har ingen routing – springer offer over`);
                        continue;
                    }
                    if (!clientSources.includes(srcNum)) {
                        console.log(`[signaling] ${id} har ikke source ${srcNum} i routing [${clientSources}] – springer over`);
                        continue;
                    }
                    console.log(`[signaling] ${id} har source ${srcNum} i routing – sender offer`);
                    io.to(c.socketId).emit("video:direct:offer", { sourceId, sdp });
                }
            }
        });
        // Mobil client beder om friske offers – send cache eller bed host om nye
        socket.on("video:direct:request", () => {
            console.log(`[signaling] video:direct:request fra ${socket.id} – beder host om friske offers`);
            const hostClient = clients.get("host-ui");
            if (hostClient) {
                const clientEntry = [...clients.entries()].find(([id, c]) => c.socketId === socket.id && id !== "host-ui")
                    ?? [...clients.entries()].find(([id]) => id !== "host-ui");
                const clientId = clientEntry?.[0];
                console.log(`[signaling] → host: offers til ${socket.id} for client ${clientId}`);
                // 🔥 Send clientId til host – host slår selv routing op i sin lokale tabel
                io.to(hostClient.socketId).emit("video:direct:request-from-client", {
                    toSocketId: socket.id,
                    clientId
                });
            }
        });
        // Host sender cleared direkte til mobil-klient
        socket.on("video:routing:cleared:to:client", ({ clientId, slot }) => {
            const mobileEntry = clients.get(clientId);
            if (mobileEntry) {
                const mobileSocket = io.sockets.sockets.get(mobileEntry.socketId);
                if (mobileSocket) {
                    mobileSocket.emit("video:routing:cleared", { slot });
                    console.log(`[signaling] cleared slot ${slot} til ${clientId}`);
                    // Bed host om nyt offer hvis ny source er sat
                    const newSources = videoRouting.get(clientId) || [];
                    if (newSources[slot - 1] > 0) {
                        const hostClient = clients.get("host-ui");
                        if (hostClient) {
                            io.to(hostClient.socketId).emit("video:direct:request-from-client", {
                                toSocketId: mobileEntry.socketId,
                                clientId
                            });
                        }
                    }
                }
            }
        });
        socket.on("video:direct:answer", ({ sourceId, sdp, fromSocketId }) => {
            console.log(`[signaling] video:direct:answer for ${sourceId} – sender til host`);
            const hostClient = clients.get("host-ui");
            if (hostClient) {
                // Send ALTID det generiske event – host's startDirectVideo lytter på dette
                io.to(hostClient.socketId).emit(`video:direct:answer:${sourceId}`, { sdp });
                // Send også specifikt event hvis fromSocketId er angivet (per-client handler)
                if (fromSocketId) {
                    io.to(hostClient.socketId).emit(`video:direct:answer:${sourceId}:${fromSocketId}`, { sdp });
                }
            }
        });
        // Mobile reports talk/latch state – relay to host and update TB channel gating
        socket.on("client:talking", ({ isTalking, channel }) => {
            const entry = [...clients.entries()].find(([id, c]) => c.socketId === socket.id && id !== "host-ui");
            if (!entry) {
                console.warn(`[signaling] client:talking – socket ${socket.id} not found in clients`);
                return;
            }
            const [clientId] = entry;
            if (channel !== undefined) {
                if (!mobileActiveTb.has(clientId))
                    mobileActiveTb.set(clientId, new Set());
                const set = mobileActiveTb.get(clientId);
                if (isTalking)
                    set.add(channel);
                else
                    set.delete(channel);
                const allConns = Array.from(connections.values()).filter(c => c.from === clientId);
                console.log(`[signaling] ${clientId} TB${channel} ${isTalking ? 'ON' : 'OFF'} | active=[${[...set]}] | outgoing conns: ${JSON.stringify(allConns)}`);
                // Immediately push updated routing to THIS phone — no debounce.
                // The 100ms broadcastRouting debounce creates a loopback window:
                // client:state:update (instant) opens the HOST gate before the phone has stopped
                // consuming producer-65, so the phone hears its own voice via HOST mic.
                socket.emit("routing:update", getEffectiveConnections());
                broadcastRouting(io);
            }
            else {
                console.log(`[signaling] client:talking from ${clientId} isTalking=${isTalking} (no channel – legacy)`);
            }
            const host = clients.get("host-ui");
            if (host) {
                // Only open the HOST gate when an active TB channel actually has a connection
                // to the HOST (producer-65). TB2/3/4 with no configured route must not bleed through.
                const activeTbs = mobileActiveTb.get(clientId) ?? new Set();
                const isConnectedToHost = Array.from(activeTbs).some(ch => Array.from(connections.values()).some(c => c.from === clientId && c.to === "producer-65" && c.toChannel === ch));
                io.to(host.socketId).emit("client:state:update", { clientId, isTalking: isConnectedToHost });
                // Push sender meter immediately so the HOST card lights up on TB press.
                // recv_ meters are driven by the phone's own audio:level events (emitted
                // at 100 ms intervals while the mic producer is active).
                const levelUpdate = {};
                const isAnyTbActive = activeTbs.size > 0;
                levelUpdate[clientId] = isAnyTbActive ? 80 : 0;
                if (!isAnyTbActive) {
                    for (const conn of connections.values()) {
                        if (conn.from === clientId)
                            levelUpdate[`recv_${conn.to}`] = 0;
                    }
                }
                io.to(host.socketId).emit("audio:levels", levelUpdate);
            }
        });
        socket.on("client:latched", ({ isLatched }) => {
            const entry = [...clients.entries()].find(([id, c]) => c.socketId === socket.id && id !== "host-ui");
            if (!entry)
                return;
            const [clientId] = entry;
            const host = clients.get("host-ui");
            // Use remoteIsLatched so the HOST's own latch state (isLatched) is not affected
            if (host)
                io.to(host.socketId).emit("client:state:update", { clientId, remoteIsLatched: isLatched });
        });
        // Mobile client pushes its talkback button names to host
        socket.on("client:talknames", (names) => {
            const entry = [...clients.entries()].find(([, c]) => c.socketId === socket.id);
            if (!entry)
                return;
            const clientId = entry[0];
            // Store on client entry
            const client = clients.get(clientId);
            if (client)
                client.talkNames = names;
            // Relay to host
            const host = clients.get("host-ui");
            if (host) {
                io.to(host.socketId).emit("client:talknames", { clientId, names });
                console.log(`[signaling] talknames from ${clientId}: ${JSON.stringify(names)}`);
            }
        });
        /* ---------- ROUTING MODE ---------- */
        socket.on("routing:mode:set", ({ clientId, enabled }) => {
            const target = clients.get(clientId);
            if (target)
                io.to(target.socketId).emit("routing:mode", { enabled });
        });
        socket.on("client:visibility:set", ({ clientId, allowedIds }) => {
            if (!Array.isArray(allowedIds) || allowedIds.length === 0) {
                clientVisibility.delete(clientId);
            }
            else {
                clientVisibility.set(clientId, allowedIds);
            }
        });
        socket.on("client:visibility:get", ({ clientId }, cb) => {
            if (typeof cb !== "function")
                return;
            cb(clientVisibility.get(clientId) ?? []);
        });
        /* ---------- SERVER CONFIG (internet / WebRTC settings from HOST UI) ---------- */
        socket.on("server:network:info", (cb) => {
            if (typeof cb !== "function")
                return;
            const lanPort = parseInt(process.env.LAN_PORT ?? "3001");
            let lanIp = "127.0.0.1";
            for (const ifaces of Object.values(os_1.default.networkInterfaces())) {
                for (const iface of ifaces ?? []) {
                    if (iface.family === "IPv4" && !iface.internal && !iface.address.startsWith("169.254.")) {
                        lanIp = iface.address;
                        break;
                    }
                }
                if (lanIp !== "127.0.0.1")
                    break;
            }
            cb({ lanIp, lanPort, port: lanPort });
        });
        socket.on("server:config:get", (cb) => {
            if (typeof cb !== "function")
                return;
            cb({
                announcedIp: process.env.MEDIASOUP_ANNOUNCED_IP ?? "",
                turnUrl: process.env.TURN_URL ?? "",
                turnUsername: process.env.TURN_USERNAME ?? "",
                turnPassword: process.env.TURN_PASSWORD ?? "",
                sessionPassword: process.env.SESSION_PASSWORD ?? "",
            });
        });
        socket.on("server:config:update", ({ announcedIp, turnUrl, turnUsername, turnPassword, sessionPassword }, cb) => {
            const toSave = {};
            if (announcedIp !== undefined) {
                process.env.MEDIASOUP_ANNOUNCED_IP = announcedIp;
                (0, mediasoup_1.setAnnouncedIp)(announcedIp);
                toSave["MEDIASOUP_ANNOUNCED_IP"] = announcedIp;
                console.log(`[signaling] announced IP updated: ${announcedIp}`);
            }
            if (turnUrl !== undefined) {
                process.env.TURN_URL = turnUrl;
                toSave["TURN_URL"] = turnUrl;
            }
            if (turnUsername !== undefined) {
                process.env.TURN_USERNAME = turnUsername;
                toSave["TURN_USERNAME"] = turnUsername;
            }
            if (turnPassword !== undefined) {
                process.env.TURN_PASSWORD = turnPassword;
                toSave["TURN_PASSWORD"] = turnPassword;
            }
            if (sessionPassword !== undefined) {
                process.env.SESSION_PASSWORD = sessionPassword;
                toSave["SESSION_PASSWORD"] = sessionPassword;
                console.log(`[signaling] session password ${sessionPassword ? "set" : "cleared"}`);
            }
            persistEnvVars(toSave);
            cb?.({ ok: true });
        });
        /* ---------- FACTORY RESET ---------- */
        socket.on("server:factory:reset", (cb) => {
            factoryReset(io);
            cb?.({ ok: true });
        });
        /* ---------- CLOUDFLARE TUNNEL ---------- */
        socket.on("server:tunnel:get", (cb) => {
            if (typeof cb !== "function")
                return;
            cb({ url: (0, tunnel_1.getTunnelUrl)(), status: (0, tunnel_1.getTunnelStatus)() });
        });
        socket.on("server:tunnel:start", async (cb) => {
            const PORT = parseInt(process.env.PORT ?? "3000");
            try {
                const url = await (0, tunnel_1.startTunnel)(PORT);
                cb?.({ ok: true, url });
            }
            catch (err) {
                cb?.({ ok: false, error: err.message });
            }
        });
        socket.on("server:tunnel:stop", (cb) => {
            (0, tunnel_1.stopTunnel)();
            cb?.({ ok: true });
        });
        /* ---------- CLIENT KICK ---------- */
        socket.on("client:kick", ({ clientId }) => {
            const target = clients.get(clientId);
            if (target) {
                const targetSocket = io.sockets.sockets.get(target.socketId);
                if (targetSocket) {
                    targetSocket.emit("kicked");
                    targetSocket.disconnect(true);
                    console.log(`[signaling] Kicked client: ${clientId}`);
                }
                clients.delete(clientId);
                broadcastRouting(io);
            }
        });
        // Host pushes channel names to a specific mobile client
        socket.on("channel:names:push", ({ clientId, names }) => {
            const target = clients.get(clientId);
            if (target) {
                const targetSocket = io.sockets.sockets.get(target.socketId);
                targetSocket?.emit("channel:names:push", names);
                console.log(`[signaling] Pushed ${Object.keys(names).length} channel names to ${clientId}`);
            }
        });
        /* ---------- STREAM DECK ---------- */
        socket.on('streamdeck:layout', (layout) => {
            console.log(`[StreamDeck] Layout received: ${layout.length} buttons`);
            exports.streamDeckManager.setLayout(layout);
            io.emit('streamdeck:layout', layout);
            save();
        });
        socket.on('streamdeck:button:active', ({ idx, active }) => {
            exports.streamDeckManager.setButtonActive(idx, active);
            io.emit('streamdeck:button:active', { idx, active });
        });
        // Host requests network connection to Stream Deck Studio
        socket.on('streamdeck:connect:network', ({ host, port }) => {
            console.log(`[StreamDeck] Network connect requested: ${host}:${port}`);
            exports.streamDeckManager.connectNetwork(host, port ?? 5343);
        });
        // Host requests mDNS auto-discovery
        socket.on('streamdeck:discover', () => {
            exports.streamDeckManager.discoverAndConnect();
        });
        socket.on('streamdeck:relay:hello', ({ model }) => {
            console.log(`[StreamDeck] Relay connected: ${model}`);
            // Send current layout to relay immediately
            socket.emit('streamdeck:layout', exports.streamDeckManager.getCurrentLayout());
        });
        // Physical key events from relay
        socket.on('streamdeck:key:down', ({ idx, clientId, isGroup, groupMemberIds }) => {
            if (isGroup && groupMemberIds) {
                groupMemberIds.forEach((id) => io.emit('client:talk', { clientId: id, isTalking: true }));
            }
            else if (clientId) {
                io.emit('client:talk', { clientId, isTalking: true });
            }
            exports.streamDeckManager.setButtonActive(idx, true);
        });
        socket.on('streamdeck:key:up', ({ idx, clientId, isGroup, groupMemberIds }) => {
            if (isGroup && groupMemberIds) {
                groupMemberIds.forEach((id) => io.emit('client:talk', { clientId: id, isTalking: false }));
            }
            else if (clientId) {
                io.emit('client:talk', { clientId, isTalking: false });
            }
            exports.streamDeckManager.setButtonActive(idx, false);
        });
        /* ---------- DISCONNECT ---------- */
        /* ---------- REMOTE PANELS (Terminals) ---------- */
        // iPad: get list of panels (no PINs)
        socket.on("terminals:list", (cb) => {
            if (typeof cb !== "function")
                return;
            const list = Array.from(terminals.values()).map(t => ({
                id: t.id,
                name: t.name,
                hasPairedClient: !!t.pairedClientId,
            }));
            cb(list);
        });
        // iPad: authenticate with PIN → returns paired clientId
        socket.on("terminal:auth", ({ terminalId, code }, cb) => {
            const t = terminals.get(terminalId);
            if (!t) {
                cb?.({ ok: false, error: "Terminal not found" });
                return;
            }
            if (t.code !== code) {
                cb?.({ ok: false, error: "Wrong PIN" });
                return;
            }
            const client = t.pairedClientId ? clients.get(t.pairedClientId) : undefined;
            cb?.({ ok: true, clientId: t.pairedClientId, clientName: client?.data?.name, clientCode: client?.data?.code });
        });
        // Host: full list with codes
        socket.on("terminals:list:host", (cb) => {
            if (typeof cb !== "function")
                return;
            const list = Array.from(terminals.values()).map(t => ({
                ...t,
                connected: !!(t.pairedClientId && (() => {
                    const c = clients.get(t.pairedClientId);
                    return c?.socketId ? !!io.sockets.sockets.get(c.socketId)?.connected : false;
                })()),
            }));
            cb(list);
        });
        // Host: create terminal
        socket.on("terminal:create", ({ name, code }, cb) => {
            const id = `terminal-${Date.now()}`;
            terminals.set(id, { id, name, code: code || "0000" });
            save();
            broadcastTerminals(io);
            cb?.({ ok: true, id });
        });
        // Host: update terminal name/code
        socket.on("terminal:update", ({ id, name, code }, cb) => {
            const t = terminals.get(id);
            if (!t) {
                cb?.({ ok: false });
                return;
            }
            terminals.set(id, { ...t, ...(name !== undefined ? { name } : {}), ...(code !== undefined ? { code } : {}) });
            save();
            broadcastTerminals(io);
            cb?.({ ok: true });
        });
        // Host: delete terminal
        socket.on("terminal:delete", ({ id }, cb) => {
            terminals.delete(id);
            save();
            broadcastTerminals(io);
            cb?.({ ok: true });
        });
        // Host: pair terminal with a client
        socket.on("terminal:pair", ({ terminalId, clientId }, cb) => {
            const t = terminals.get(terminalId);
            if (!t) {
                cb?.({ ok: false });
                return;
            }
            terminals.set(terminalId, { ...t, pairedClientId: clientId ?? undefined });
            save();
            broadcastTerminals(io);
            cb?.({ ok: true });
        });
        socket.on("disconnect", () => {
            // Find ALL clients registered on this socket (not just the first one)
            const disconnectedIds = [...clients.entries()]
                .filter(([, v]) => v.socketId === socket.id)
                .map(([id]) => id);
            if (disconnectedIds.length === 0)
                return;
            disconnectedIds.forEach(clientId => {
                io.emit("clients:update", { id: clientId, updates: { status: "offline" } });
                (0, audioOutput_1.stopAllForClient)(clientId).catch(() => { });
                mobileActiveTb.delete(clientId);
                const existingEntry = clients.get(clientId);
                offlineClients.set(clientId, existingEntry?.data);
                // Keep client in Map as "offline" so phone can still find it in clients:list.
                // Grace period timer uses socketId check to detect reconnect instead of clients.has().
                if (existingEntry) {
                    clients.set(clientId, { socketId: "", data: { ...existingEntry.data, status: "offline" } });
                }
                // Grace period: give the client 8 seconds to reconnect before wiping connections.
                // Use a timestamp so that a rapid disconnect→reconnect→disconnect sequence doesn't
                // let an earlier timer prematurely delete connections for the later disconnect.
                const disconnectTime = Date.now();
                disconnectTimes.set(clientId, disconnectTime);
                setTimeout(() => {
                    // Abort if a newer disconnect has since occurred for this client
                    if (disconnectTimes.get(clientId) !== disconnectTime)
                        return;
                    const reconnected = clients.get(clientId);
                    if (reconnected?.socketId) {
                        disconnectTimes.delete(clientId);
                        return;
                    }
                    disconnectTimes.delete(clientId);
                    offlineClients.delete(clientId);
                    producers.delete(clientId);
                    for (const [k, c] of connections) {
                        // Keep bridge→client connections — operator set these intentionally.
                        if ((c.from === clientId || c.to === clientId) && !c.from.startsWith("bridge-"))
                            connections.delete(k);
                    }
                    broadcastRouting(io);
                    save();
                }, 8000);
            });
            broadcastRouting(io);
        });
    });
}
class StreamDeckManager {
    constructor() {
        this.deck = null;
        this.layout = [];
        this.tcpSocket = null;
        this.keepAliveInterval = null;
    }
    // ── Connect via USB (local) ──────────────────────────────────────────────
    async connect() {
        try {
            const { openStreamDeck, listStreamDecks } = await Promise.resolve(`${'@elgato-stream-deck/node'}`).then(s => __importStar(require(s)));
            let devices = [];
            try {
                devices = listStreamDecks();
            }
            catch { /* no devices */ }
            if (devices.length === 0) {
                // No USB Stream Deck – use network connection instead
                return;
            }
            this.deck = openStreamDeck(devices[0].path);
            console.log(`[StreamDeck] ✅ USB Connected: ${devices[0].model}`);
            this.setupDeckListeners();
            this.renderAll();
        }
        catch (e) {
            if (e.message?.includes('Cannot find module')) {
                console.log('[StreamDeck] Package not installed');
            }
            else {
                console.warn('[StreamDeck] USB error:', e.message);
                // No retry – connect via network instead
            }
        }
    }
    // ── Connect via TCP/IP (network) ─────────────────────────────────────────
    // Stream Deck Studio exposes TCP port 5343 over Ethernet
    // Protocol is binary, same as USB HID
    async connectNetwork(host, port = 5343) {
        const net = await Promise.resolve().then(() => __importStar(require('net')));
        console.log(`[StreamDeck] Connecting via TCP to ${host}:${port}...`);
        const attemptConnect = () => {
            this.tcpSocket = net.createConnection({ host, port });
            this.tcpSocket.on('connect', () => {
                console.log(`[StreamDeck] ✅ Network Connected: ${host}:${port}`);
                // Send keepalive every 3.5 seconds (required by Stream Deck Studio)
                this.keepAliveInterval = setInterval(() => {
                    if (this.tcpSocket?.writable) {
                        this.tcpSocket.write(Buffer.alloc(1, 0x00)); // null keepalive byte
                    }
                }, 3500);
                this.renderAllNetwork();
            });
            this.tcpSocket.on('data', (data) => {
                this.parseNetworkData(data);
            });
            this.tcpSocket.on('error', (e) => {
                console.warn(`[StreamDeck] Network error: ${e.message} – retrying in 5s`);
                this.cleanupTcp();
                setTimeout(attemptConnect, 5000);
            });
            this.tcpSocket.on('close', () => {
                console.log('[StreamDeck] Network disconnected – retrying in 5s');
                this.cleanupTcp();
                setTimeout(attemptConnect, 5000);
            });
        };
        attemptConnect();
    }
    // ── mDNS auto-discovery ───────────────────────────────────────────────────
    async discoverAndConnect() {
        try {
            const mdns = await Promise.resolve(`${'mdns'}`).then(s => __importStar(require(s))).catch(() => null);
            if (!mdns) {
                console.log('[StreamDeck] mdns not available – use connectNetwork(ip) manually');
                return;
            }
            const browser = mdns.createBrowser(mdns.tcp('elgato'));
            browser.on('serviceUp', (service) => {
                const host = service.addresses?.[0];
                if (host) {
                    console.log(`[StreamDeck] mDNS discovered: ${service.name} at ${host}`);
                    browser.stop();
                    this.connectNetwork(host, 5343);
                }
            });
            browser.start();
            console.log('[StreamDeck] mDNS discovery started...');
        }
        catch (e) {
            console.log('[StreamDeck] mDNS discovery unavailable');
        }
    }
    cleanupTcp() {
        clearInterval(this.keepAliveInterval);
        this.keepAliveInterval = null;
        try {
            this.tcpSocket?.destroy();
        }
        catch { }
        this.tcpSocket = null;
    }
    parseNetworkData(data) {
        // Stream Deck Studio TCP protocol mirrors USB HID
        // Button press events: byte 0 = report type, byte 1+ = key states
        // This is a simplified parser – full protocol in go-streamdeck repo
        if (data.length >= 2) {
            const reportType = data[0];
            if (reportType === 0x01) { // Key state report
                for (let i = 1; i < data.length; i++) {
                    const keyIdx = i - 1;
                    const isDown = data[i] === 1;
                    if (keyIdx < this.layout.length) {
                        const wasDown = this.layout[keyIdx]?.active ?? false;
                        if (isDown !== wasDown) {
                            if (isDown)
                                this.handleKeyDown(keyIdx);
                            else
                                this.handleKeyUp(keyIdx);
                        }
                    }
                }
            }
        }
    }
    renderAllNetwork() {
        if (!this.tcpSocket?.writable)
            return;
        for (let i = 0; i < (this.layout.length || 32); i++) {
            this.renderButtonNetwork(i);
        }
    }
    renderButtonNetwork(idx) {
        if (!this.tcpSocket?.writable)
            return;
        const size = 96;
        const { createCanvas } = (() => { try {
            return require('canvas');
        }
        catch {
            return { createCanvas: null };
        } })();
        if (!createCanvas)
            return;
        const img = this.drawButton(createCanvas, idx, size);
        if (!img)
            return;
        // Stream Deck Studio image packet format over TCP
        // Header: [0x02, keyIndex, 0x00, 0x01, widthLo, widthHi, heightLo, heightHi] + JPEG data
        try {
            const jpeg = img.toBuffer('image/jpeg', { quality: 0.9 });
            const header = Buffer.alloc(8);
            header[0] = 0x02;
            header[1] = idx;
            header[2] = 0x00;
            header[3] = 0x01;
            header.writeUInt16LE(size, 4);
            header.writeUInt16LE(size, 6);
            this.tcpSocket.write(Buffer.concat([header, jpeg]));
        }
        catch { }
    }
    setCallbacks(onTalk, onGroupTalk, ioInstance) {
        this.onTalkChange = onTalk;
        this.onGroupTalkChange = onGroupTalk;
        this.io = ioInstance;
    }
    getCurrentLayout() { return this.layout; }
    setLayout(layout) {
        this.layout = layout;
        if (this.deck)
            this.renderAll();
        if (this.tcpSocket?.writable)
            this.renderAllNetwork();
    }
    setButtonActive(idx, active) {
        if (!this.layout[idx])
            return;
        this.layout[idx].active = active;
        if (this.deck)
            this.renderButton(idx);
        if (this.tcpSocket?.writable)
            this.renderButtonNetwork(idx);
    }
    setupDeckListeners() {
        if (!this.deck)
            return;
        this.deck.on('down', (k) => this.handleKeyDown(k));
        this.deck.on('up', (k) => this.handleKeyUp(k));
        this.deck.on('error', (e) => {
            console.warn('[StreamDeck] Error:', e.message);
            this.deck = null;
            setTimeout(() => this.connect(), 3000);
        });
    }
    handleKeyDown(keyIndex) {
        const btn = this.layout[keyIndex];
        if (!btn)
            return;
        console.log(`[StreamDeck] Key DOWN: ${keyIndex} – ${btn.label}`);
        btn.active = true;
        if (this.deck)
            this.renderButton(keyIndex);
        if (this.tcpSocket?.writable)
            this.renderButtonNetwork(keyIndex);
        if (btn.isGroup && btn.groupMemberIds) {
            this.onGroupTalkChange?.(btn.groupMemberIds, true);
            this.io?.emit('streamdeck:group:talk', { memberIds: btn.groupMemberIds, val: true });
        }
        else if (btn.clientId) {
            this.onTalkChange?.(btn.clientId, true);
            this.io?.emit('client:talk', { clientId: btn.clientId, isTalking: true });
        }
    }
    handleKeyUp(keyIndex) {
        const btn = this.layout[keyIndex];
        if (!btn)
            return;
        console.log(`[StreamDeck] Key UP: ${keyIndex} – ${btn.label}`);
        btn.active = false;
        if (this.deck)
            this.renderButton(keyIndex);
        if (this.tcpSocket?.writable)
            this.renderButtonNetwork(keyIndex);
        if (btn.isGroup && btn.groupMemberIds) {
            this.onGroupTalkChange?.(btn.groupMemberIds, false);
            this.io?.emit('streamdeck:group:talk', { memberIds: btn.groupMemberIds, val: false });
        }
        else if (btn.clientId) {
            this.onTalkChange?.(btn.clientId, false);
            this.io?.emit('client:talk', { clientId: btn.clientId, isTalking: false });
        }
    }
    drawButton(createCanvas, idx, size) {
        const btn = this.layout[idx];
        const canvas = createCanvas(size, size);
        const ctx = canvas.getContext('2d');
        if (btn) {
            ctx.fillStyle = btn.active ? '#ffffff' : (btn.color || '#1a1a1a');
            ctx.fillRect(0, 0, size, size);
            if (btn.isGroup) {
                ctx.fillStyle = (btn.active ? '#000' : '#fff') + '30';
                ctx.fillRect(0, size - 8, size, 8);
            }
            ctx.fillStyle = btn.active ? '#000000' : '#ffffff';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            const words = (btn.label || '').toUpperCase().split(' ');
            const lines = [];
            let cur = '';
            const fontSize = Math.round(size * 0.17);
            ctx.font = `bold ${fontSize}px Arial`;
            for (const w of words) {
                const test = cur ? `${cur} ${w}` : w;
                if (ctx.measureText(test).width > size * 0.85) {
                    if (cur)
                        lines.push(cur);
                    cur = w;
                }
                else
                    cur = test;
            }
            if (cur)
                lines.push(cur);
            const lineH = fontSize * 1.3;
            const startY = (size - lines.length * lineH) / 2 + lineH / 2;
            lines.forEach((line, i) => ctx.fillText(line, size / 2, startY + i * lineH));
            if (btn.active) {
                ctx.strokeStyle = btn.color || '#f97316';
                ctx.lineWidth = 5;
                ctx.strokeRect(2.5, 2.5, size - 5, size - 5);
            }
        }
        else {
            ctx.fillStyle = '#0d0d0d';
            ctx.fillRect(0, 0, size, size);
            ctx.fillStyle = '#1a1a1a';
            ctx.font = `bold ${Math.round(size * 0.2)}px Arial`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(String(idx + 1), size / 2, size / 2);
        }
        return canvas;
    }
    renderButton(idx) {
        if (!this.deck)
            return;
        const size = this.deck.ICON_SIZE ?? 96;
        const { createCanvas } = (() => { try {
            return require('canvas');
        }
        catch {
            return { createCanvas: null };
        } })();
        if (!createCanvas) {
            const btn = this.layout[idx];
            const col = btn ? this.hexToRgb(btn.active ? '#ffffff' : btn.color) : { r: 10, g: 10, b: 10 };
            try {
                this.deck.fillKeyColor(idx, col.r, col.g, col.b);
            }
            catch { }
            return;
        }
        const canvas = this.drawButton(createCanvas, idx, size);
        try {
            this.deck.fillKeyBuffer(idx, canvas.toBuffer('raw'), { format: 'rgba' });
        }
        catch {
            try {
                this.deck.fillImage(idx, canvas.toBuffer('raw'));
            }
            catch { }
        }
    }
    renderAll() {
        if (!this.deck)
            return;
        const count = this.deck.KEY_COUNT ?? 32;
        for (let i = 0; i < count; i++)
            this.renderButton(i);
    }
    hexToRgb(hex) {
        return { r: parseInt(hex.slice(1, 3), 16), g: parseInt(hex.slice(3, 5), 16), b: parseInt(hex.slice(5, 7), 16) };
    }
    disconnect() {
        try {
            this.deck?.close();
        }
        catch { }
        this.cleanupTcp();
        this.deck = null;
    }
}
exports.StreamDeckManager = StreamDeckManager;
// Singleton instance – imported by server.ts
exports.streamDeckManager = new StreamDeckManager();
//# sourceMappingURL=signaling.js.map