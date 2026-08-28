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
Object.defineProperty(exports, "__esModule", { value: true });
exports.router = void 0;
exports.setAnnouncedIp = setAnnouncedIp;
exports.initMediasoup = initMediasoup;
exports.createTransport = createTransport;
exports.connectTransport = connectTransport;
exports.produce = produce;
exports.consume = consume;
exports.getProducer = getProducer;
exports.getConsumer = getConsumer;
exports.getTransport = getTransport;
const mediasoup = __importStar(require("mediasoup"));
const os = __importStar(require("os"));
function getLocalIp() {
    for (const ifaces of Object.values(os.networkInterfaces())) {
        for (const iface of ifaces ?? []) {
            if (iface.family === "IPv4" && !iface.internal && !iface.address.startsWith("169.254."))
                return iface.address;
        }
    }
    return "127.0.0.1";
}
let worker;
// Announced IP can be updated at runtime from the HOST UI without restarting.
let _runtimeAnnouncedIp = null;
function setAnnouncedIp(ip) { _runtimeAnnouncedIp = ip || null; }
const transports = new Map();
const producers = new Map();
const consumers = new Map();
/* ---------- INIT ---------- */
async function initMediasoup() {
    worker = await mediasoup.createWorker({
        logLevel: "warn",
        rtcMinPort: 40000,
        rtcMaxPort: 49999
    });
    worker.on("died", () => {
        console.error("mediasoup worker died – restarting process");
        process.exit(1);
    });
    exports.router = await worker.createRouter({
        mediaCodecs: [
            {
                kind: "audio",
                mimeType: "audio/opus",
                clockRate: 48000,
                channels: 2
            },
            {
                kind: "video",
                mimeType: "video/VP8",
                clockRate: 90000,
                parameters: { "x-google-start-bitrate": 1000 }
            },
            {
                kind: "video",
                mimeType: "video/H264",
                clockRate: 90000,
                parameters: {
                    "packetization-mode": 1,
                    "profile-level-id": "42e01f",
                    "level-asymmetry-allowed": 1
                }
            }
        ]
    });
    console.log("✅ Mediasoup router created");
}
/* ---------- CREATE TRANSPORT ---------- */
async function createTransport(direction) {
    const localIp = getLocalIp();
    // Announce local LAN IP so phones on the same network get a reachable ICE candidate.
    // The external IP (MEDIASOUP_ANNOUNCED_IP) only matters for internet clients, which
    // currently use Cloudflare tunnel (no UDP relay) so WebRTC to external IPs doesn't
    // work anyway. Local-only is correct for all current use cases.
    const announcedIp = localIp;
    const transport = await exports.router.createWebRtcTransport({
        listenIps: [{ ip: "0.0.0.0", announcedIp }],
        enableUdp: true,
        enableTcp: true,
        preferUdp: true,
        initialAvailableOutgoingBitrate: 1000000
    });
    transports.set(transport.id, transport);
    transport.on("dtlsstatechange", (state) => {
        if (state === "closed") {
            transports.delete(transport.id);
        }
    });
    return transport;
}
/* ---------- CONNECT TRANSPORT ---------- */
async function connectTransport(transportId, dtlsParameters) {
    const transport = transports.get(transportId);
    if (!transport) {
        console.error("connectTransport: transport not found", transportId);
        return;
    }
    await transport.connect({ dtlsParameters });
}
async function produce(transportId, kind, rtpParameters) {
    const transport = transports.get(transportId);
    if (!transport)
        throw new Error(`produce: transport not found ${transportId}`);
    const producer = await transport.produce({ kind, rtpParameters });
    producers.set(producer.id, producer);
    producer.on("transportclose", () => {
        producers.delete(producer.id);
    });
    console.log(`✅ Producer created: ${producer.id} (${kind})`);
    return producer;
}
/* ---------- 🔥 CONSUME – WAS MISSING ---------- */
async function consume(transportId, producerId, rtpCapabilities) {
    const transport = transports.get(transportId);
    if (!transport)
        throw new Error(`consume: transport not found ${transportId}`);
    // Check router can consume this producer
    if (!exports.router.canConsume({ producerId, rtpCapabilities })) {
        throw new Error(`consume: router cannot consume producer ${producerId}`);
    }
    const consumer = await transport.consume({
        producerId,
        rtpCapabilities,
        paused: false // Start unpaused so audio flows immediately
    });
    consumers.set(consumer.id, consumer);
    consumer.on("transportclose", () => {
        consumers.delete(consumer.id);
    });
    consumer.on("producerclose", () => {
        consumers.delete(consumer.id);
    });
    console.log(`✅ Consumer created: ${consumer.id} → producer ${producerId}`);
    return consumer;
}
/* ---------- GETTERS ---------- */
function getProducer(producerId) {
    return producers.get(producerId);
}
function getConsumer(consumerId) {
    return consumers.get(consumerId);
}
function getTransport(transportId) {
    return transports.get(transportId);
}
//# sourceMappingURL=mediasoup.js.map