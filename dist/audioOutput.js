"use strict";
/**
 * audioOutput.ts
 *
 * Routes a mobile client's TB audio (mediasoup producer) to a specific
 * hardware output channel on the soundcard.
 *
 * naudiodon/PortAudio is run in an isolated child process (audioOutputWorker.js)
 * so a SIGSEGV there cannot kill the main server.
 *
 * Flow:
 *   mediasoup producer
 *     → PlainTransport (server-side consumer)
 *     → UDP socket (raw RTP on localhost → worker process)
 *     → audioOutputWorker: opusscript decoder + naudiodon AudioIO
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
const path = __importStar(require("path"));
const child_process_1 = require("child_process");
const child_process_2 = require("child_process");
const mediasoup_1 = require("./mediasoup");
/* ---- STATE ---- */
// Active routes: key = "${clientId}:ch${hwChannel}"
const activeRoutes = new Map();
// Per hw-channel device config (set by host via socket event)
const channelConfigs = new Map();
// Known device max output channels — populated by registerOutputDevice() and listOutputDevices().
const deviceMaxOutputChannels = new Map();
/* ---- PUBLIC API ---- */
function registerOutputDevice(deviceId, maxOutputChannels) {
    deviceMaxOutputChannels.set(deviceId, maxOutputChannels);
    console.log(`[audioOutput] registered device ${deviceId}: max ${maxOutputChannels} output channels`);
}
// List audio output devices via FFmpeg AVFoundation.
function listOutputDevices(cb) {
    const ffmpegBin = ["/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg", "/usr/bin/ffmpeg"]
        .find(p => { try {
        require("fs").accessSync(p);
        return true;
    }
    catch {
        return false;
    } }) ?? "ffmpeg";
    (0, child_process_2.execFile)(ffmpegBin, ["-f", "avfoundation", "-list_devices", "true", "-i", ""], (_, __, stderr) => {
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
                    let maxCh = deviceMaxOutputChannels.get(id);
                    if (maxCh === undefined) {
                        if (/universal audio|apollo/i.test(name))
                            maxCh = 8;
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
    const { deviceId, deviceChannels } = getChannelConfig(hwChannel);
    // Guard: validate deviceChannels against known device limits before spawning worker.
    if (deviceId >= 0) {
        const maxCh = deviceMaxOutputChannels.get(deviceId);
        if (maxCh !== undefined && deviceChannels > maxCh) {
            console.error(`[audioOutput] ❌ ch${hwChannel}: deviceChannels=${deviceChannels} exceeds ` +
                `device ${deviceId} max=${maxCh} — refusing (would crash). Reconfigure via output routing UI.`);
            return;
        }
        if (deviceChannels < 1) {
            console.error(`[audioOutput] ❌ ch${hwChannel}: invalid deviceChannels=${deviceChannels}`);
            return;
        }
    }
    try {
        // 1. Spawn worker — naudiodon runs in isolated child process, SIGSEGV cannot kill us
        const workerPath = path.join(__dirname, "audioOutputWorker.js");
        const worker = (0, child_process_1.spawn)(process.execPath, [
            workerPath,
            String(deviceId),
            String(deviceChannels),
            String(hwChannel),
        ], { stdio: ["pipe", "pipe", "pipe"] });
        worker.stderr.on("data", (d) => console.warn(`[audioOutputWorker pid=${worker.pid}] ${d.toString().trim()}`));
        // 2. Wait for READY:<port> or ERROR:<msg>
        const rtpPort = await new Promise((resolve, reject) => {
            const timer = setTimeout(() => { worker.kill(); reject(new Error("audioOutputWorker start timeout")); }, 6000);
            let buf = "";
            worker.stdout.on("data", (d) => {
                buf += d.toString();
                const lines = buf.split("\n");
                for (const line of lines.slice(0, -1)) {
                    if (line.startsWith("READY:")) {
                        clearTimeout(timer);
                        resolve(parseInt(line.slice(6)));
                    }
                    else if (line.startsWith("ERROR:")) {
                        clearTimeout(timer);
                        worker.kill();
                        reject(new Error(line.slice(6)));
                    }
                }
                buf = lines[lines.length - 1];
            });
            worker.on("exit", (code) => {
                clearTimeout(timer);
                reject(new Error(`worker exited prematurely (code ${code})`));
            });
        });
        // 3. PlainTransport: mediasoup sends consumer RTP to worker's UDP socket
        const plainTransport = await mediasoup_1.router.createPlainTransport({
            listenIp: { ip: "127.0.0.1", announcedIp: "127.0.0.1" },
            rtcpMux: true,
            comedia: false,
        });
        await plainTransport.connect({ ip: "127.0.0.1", port: rtpPort });
        // 4. Server-side consumer taps the producer's audio
        const consumer = await plainTransport.consume({
            producerId,
            rtpCapabilities: mediasoup_1.router.rtpCapabilities,
            paused: false,
        });
        if (consumer.paused)
            await consumer.resume();
        worker.on("exit", (code) => {
            console.log(`[audioOutput] worker for ${key} exited (code ${code})`);
            activeRoutes.delete(key);
        });
        activeRoutes.set(key, { plainTransport, consumer, worker });
        console.log(`[audioOutput] ✅ ${clientId} → hw ch${hwChannel}` +
            ` (device ${deviceId}, ${deviceChannels}ch, chIdx=${(hwChannel - 1) % deviceChannels}) pid=${worker.pid}`);
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
        route.worker.stdin.write("stop\n");
    }
    catch { }
    // Give worker 2 s to clean up, then force-kill
    setTimeout(() => { try {
        route.worker.kill("SIGTERM");
    }
    catch { } }, 2000);
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