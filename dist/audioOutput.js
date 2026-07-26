"use strict";
/**
 * audioOutput.ts
 *
 * Routes a mobile client's TB audio (mediasoup producer) to a specific
 * hardware output channel on the soundcard.
 *
 * Flow:
 *   mediasoup producer
 *     → PlainTransport (server-side consumer)
 *     → UDP socket (raw RTP on localhost)
 *     → opusscript decoder (Opus → Int16 PCM)
 *     → naudiodon AudioIO (PCM → specific hardware channel)
 */
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
exports.registerOutputDevice = registerOutputDevice;
exports.listOutputDevices = listOutputDevices;
exports.setChannelConfig = setChannelConfig;
exports.getChannelConfig = getChannelConfig;
exports.startOutputRoute = startOutputRoute;
exports.stopOutputRoute = stopOutputRoute;
exports.stopAllForClient = stopAllForClient;
exports.getActiveRouteKeys = getActiveRouteKeys;
const dgram = __importStar(require("dgram"));
const child_process_1 = require("child_process");
const mediasoup_1 = require("./mediasoup");
// Dynamic requires — naudiodon is a native addon, opusscript is pure JS
let OpusScript = null;
let naudiodon = null;
try {
    OpusScript = require("opusscript");
    console.log("[audioOutput] opusscript loaded");
}
catch (e) {
    console.warn("[audioOutput] opusscript not available:", e.message);
}
try {
    naudiodon = require("naudiodon");
    // NOTE: do NOT call naudiodon.getDevices() — it segfaults on some macOS systems
    // due to a PortAudio initialization bug. AudioIO construction is fine.
    console.log("[audioOutput] naudiodon loaded");
}
catch (e) {
    console.warn("[audioOutput] naudiodon not available:", e.message);
}
/* ---- STATE ---- */
// Active routes: key = "${clientId}:ch${hwChannel}"
const activeRoutes = new Map();
// Per hw-channel device config (set by host via socket event)
const channelConfigs = new Map();
// Known device max output channels — populated by registerOutputDevice() and listOutputDevices().
// Used to guard against naudiodon SIGSEGV from invalid channel count.
const deviceMaxOutputChannels = new Map();
/* ---- PUBLIC API ---- */
// Register a device's max output channel count — called by audioCapture when a device
// session starts, so we know valid limits before AudioIO construction.
function registerOutputDevice(deviceId, maxOutputChannels) {
    deviceMaxOutputChannels.set(deviceId, maxOutputChannels);
    console.log(`[audioOutput] registered device ${deviceId}: max ${maxOutputChannels} output channels`);
}
// List audio output devices via FFmpeg AVFoundation (safe — no PortAudio crash risk).
// Calls back with an array of { id, name, maxOutputChannels, defaultSampleRate }.
// id here is the AVFoundation device index, which is also the naudiodon deviceId
// (PortAudio on macOS enumerates AVFoundation devices in the same order).
function listOutputDevices(cb) {
    const ffmpegBin = ["/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg", "/usr/bin/ffmpeg"]
        .find(p => { try {
        require("fs").accessSync(p);
        return true;
    }
    catch {
        return false;
    } }) ?? "ffmpeg";
    (0, child_process_1.execFile)(ffmpegBin, ["-f", "avfoundation", "-list_devices", "true", "-i", ""], (_, __, stderr) => {
        const devices = [];
        let inAudio = false;
        for (const line of stderr.split("\n")) {
            if (/AVFoundation audio devices/i.test(line)) {
                inAudio = true;
                continue;
            }
            if (inAudio) {
                const m = line.match(/\[(\d+)\]\s+(.+)/);
                if (m) {
                    const id = parseInt(m[1]);
                    const name = m[2].trim();
                    // Use registered max if available; fall back to name-based heuristic
                    let maxCh = deviceMaxOutputChannels.get(id);
                    if (maxCh === undefined) {
                        if (/universal audio|apollo/i.test(name))
                            maxCh = 6;
                        else if (/focusrite|scarlett|clarett/i.test(name))
                            maxCh = 8;
                        else
                            maxCh = 2;
                        deviceMaxOutputChannels.set(id, maxCh);
                    }
                    devices.push({ id, name, maxOutputChannels: maxCh, defaultSampleRate: 48000 });
                }
                else if (line.includes("AVFoundation") && line.includes("devices")) {
                    inAudio = false;
                }
            }
        }
        cb(devices);
    });
}
function setChannelConfig(hwChannel, config) {
    channelConfigs.set(hwChannel, config);
    console.log(`[audioOutput] ch${hwChannel} config: device ${config.deviceId}, ${config.deviceChannels} hw channels`);
}
function getChannelConfig(hwChannel) {
    return channelConfigs.get(hwChannel) ?? { deviceId: -1, deviceChannels: 2 };
}
async function startOutputRoute(clientId, producerId, hwChannel) {
    const key = `${clientId}:ch${hwChannel}`;
    await stopOutputRoute(clientId, hwChannel);
    if (!OpusScript) {
        console.warn("[audioOutput] opusscript missing — cannot start output route");
        return;
    }
    if (!naudiodon) {
        console.warn("[audioOutput] naudiodon missing — cannot start output route");
        return;
    }
    const { deviceId, deviceChannels } = getChannelConfig(hwChannel);
    // Guard: validate deviceChannels against known device limits BEFORE creating AudioIO.
    // naudiodon will SIGSEGV (kills the entire process) if channelCount > device's actual channels.
    if (deviceId >= 0) {
        const maxCh = deviceMaxOutputChannels.get(deviceId);
        if (maxCh !== undefined && deviceChannels > maxCh) {
            console.error(`[audioOutput] ❌ ch${hwChannel}: deviceChannels=${deviceChannels} exceeds device ${deviceId} max=${maxCh}` +
                ` — refusing AudioIO creation (would SIGSEGV). Reconfigure via output routing UI.`);
            return;
        }
        if (deviceChannels < 1) {
            console.error(`[audioOutput] ❌ ch${hwChannel}: invalid deviceChannels=${deviceChannels}`);
            return;
        }
    }
    const chIdx = (hwChannel - 1) % deviceChannels; // 0-based index within device
    try {
        // 1. UDP socket — receives RTP from mediasoup PlainTransport
        const rtpSocket = dgram.createSocket("udp4");
        await new Promise((res, rej) => rtpSocket.bind(0, "127.0.0.1", (err) => (err ? rej(err) : res())));
        const rtpPort = rtpSocket.address().port;
        // 2. PlainTransport: mediasoup sends consumer RTP to our UDP socket
        const plainTransport = await mediasoup_1.router.createPlainTransport({
            listenIp: { ip: "127.0.0.1", announcedIp: "127.0.0.1" },
            rtcpMux: true,
            comedia: false,
        });
        // Tell the transport to deliver RTP to our bound socket
        await plainTransport.connect({ ip: "127.0.0.1", port: rtpPort });
        // 3. Server-side consumer taps the producer's audio
        const consumer = await plainTransport.consume({
            producerId,
            rtpCapabilities: mediasoup_1.router.rtpCapabilities,
            paused: false,
        });
        if (consumer.paused)
            await consumer.resume();
        // 4. naudiodon output stream on target device
        const audioStream = new naudiodon.AudioIO({
            outOptions: {
                channelCount: deviceChannels,
                sampleFormat: naudiodon.SampleFormat16Bit,
                sampleRate: 48000,
                deviceId,
                closeOnError: false,
            },
        });
        audioStream.start();
        // 5. Opus decoder — 48 kHz mono (mobile mic is always mono)
        const decoder = new OpusScript(48000, 1);
        const FRAME_SIZE = 960; // 20 ms at 48 kHz
        rtpSocket.on("message", (msg) => {
            try {
                if (msg.length < 12)
                    return;
                // Parse RTP header
                const cc = msg[0] & 0x0f;
                const hasExt = (msg[0] & 0x10) !== 0;
                let hdrLen = 12 + cc * 4;
                if (hasExt && msg.length > hdrLen + 4) {
                    const extWords = msg.readUInt16BE(hdrLen + 2);
                    hdrLen += 4 + extWords * 4;
                }
                const hasPad = (msg[0] & 0x20) !== 0;
                let end = msg.length;
                if (hasPad && end > hdrLen)
                    end -= msg[end - 1];
                const payload = msg.slice(hdrLen, end);
                if (!payload.length)
                    return;
                // Decode Opus → Int16 PCM
                const pcm = decoder.decode(payload, FRAME_SIZE);
                // Interleave: write audio only at target channel, silence everywhere else
                const outBuf = Buffer.allocUnsafe(pcm.length * deviceChannels * 2);
                for (let i = 0; i < pcm.length; i++) {
                    for (let c = 0; c < deviceChannels; c++) {
                        outBuf.writeInt16LE(c === chIdx ? pcm[i] : 0, (i * deviceChannels + c) * 2);
                    }
                }
                audioStream.write(outBuf);
            }
            catch {
                // absorb decode errors
            }
        });
        activeRoutes.set(key, { plainTransport, consumer, rtpSocket, audioStream });
        console.log(`[audioOutput] ✅ ${clientId} → hw ch${hwChannel}` +
            ` (device ${deviceId}, ch idx ${chIdx}/${deviceChannels})`);
    }
    catch (e) {
        console.error("[audioOutput] startOutputRoute failed:", e);
    }
}
async function stopOutputRoute(clientId, hwChannel) {
    const key = `${clientId}:ch${hwChannel}`;
    const route = activeRoutes.get(key);
    if (!route)
        return;
    try {
        route.consumer.close();
    }
    catch { }
    try {
        route.plainTransport.close();
    }
    catch { }
    try {
        route.rtpSocket.close();
    }
    catch { }
    try {
        route.audioStream.quit();
    }
    catch { }
    activeRoutes.delete(key);
    console.log(`[audioOutput] stopped: ${clientId} → hw ch${hwChannel}`);
}
async function stopAllForClient(clientId) {
    const prefix = `${clientId}:ch`;
    for (const key of [...activeRoutes.keys()]) {
        if (!key.startsWith(prefix))
            continue;
        const hwChannel = parseInt(key.slice(prefix.length));
        await stopOutputRoute(clientId, hwChannel);
    }
}
function getActiveRouteKeys() {
    return [...activeRoutes.keys()];
}
//# sourceMappingURL=audioOutput.js.map