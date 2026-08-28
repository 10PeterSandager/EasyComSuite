"use strict";
/**
 * audioCapture.ts – multi-kanal med auto-detect og config-bridge
 *
 * Kanal-navne og typer bestemmes i prioriteret rækkefølge:
 *  1. audioDeviceConfig.json (admin-override, valgfri)
 *  2. Auto-detect baseret på enhedsnavn + antal kanaler
 *  3. Fallback: CH1, CH2 ... (alle input)
 *
 * Platform-support:
 *  - macOS  : Swift binary (audio_capture_bin) via CoreAudio
 *  - Windows: naudiodon (PortAudio/WASAPI) – ingen ekstern binary nødvendig
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
exports.setupAudioCapture = setupAudioCapture;
const child_process_1 = require("child_process");
const child_process_2 = require("child_process");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const events_1 = require("events");
const audioOutput_1 = require("./audioOutput");
/* ---- PLATFORM ---- */
const IS_MAC = process.platform === "darwin";
const CAPTURE_BIN = path.join(__dirname, "audio_capture_bin");
let naudiodon = null;
if (!IS_MAC) {
    try {
        naudiodon = require("naudiodon");
        console.log("✅ naudiodon loaded for Windows/Linux audio capture");
    }
    catch (e) {
        console.error("❌ naudiodon failed to load:", e.message);
    }
}
const sessions = new Map();
/* ---- CONFIG FILE ---- */
function loadConfig() {
    try {
        const p = path.join(__dirname, "audioDeviceConfig.json");
        if (fs.existsSync(p))
            return JSON.parse(fs.readFileSync(p, "utf-8"));
    }
    catch { }
    return {};
}
/* ---- AUTO-DETECT ---- */
const KNOWN_DEVICES = [
    {
        // Universal Audio Apollo (Thunderbolt/USB)
        match: /universal audio|apollo/i,
        getChannels: (total) => {
            const ch = [];
            for (let i = 1; i <= total; i++) {
                let name = `CH${i}`;
                let type = "input";
                if (i <= 2) {
                    name = `Mic ${i}`;
                    type = "input";
                }
                else if (i <= 8) {
                    name = `Line ${i}`;
                    type = "input";
                }
                else if (i <= 16) {
                    name = `ADAT ${i - 8}`;
                    type = "input";
                }
                else if (i === 17) {
                    name = "Loopback L";
                    type = "input";
                }
                else if (i === 18) {
                    name = "Loopback R";
                    type = "input";
                }
                else if (i <= 26) {
                    name = `Line Out ${i - 18}`;
                    type = "output";
                }
                else if (i === 27) {
                    name = "Loopback 2 L";
                    type = "input";
                }
                else if (i === 28) {
                    name = "Loopback 2 R";
                    type = "input";
                }
                else if (i === 29) {
                    name = "Loopback 3 L";
                    type = "input";
                }
                else if (i === 30) {
                    name = "Loopback 3 R";
                    type = "input";
                }
                ch.push({ channel: i, name, type, autoDetected: true });
            }
            return ch;
        }
    },
    {
        // Focusrite Scarlett / Clarett
        match: /focusrite|scarlett|clarett/i,
        getChannels: (total) => {
            const ch = [];
            const outputStart = Math.ceil(total / 2) + 1;
            for (let i = 1; i <= total; i++) {
                const isOut = i >= outputStart;
                let name = isOut ? `Out ${i - outputStart + 1}` : `In ${i}`;
                if (i === 1 && !isOut)
                    name = "Mic/Line L";
                if (i === 2 && !isOut)
                    name = "Mic/Line R";
                ch.push({ channel: i, name, type: isOut ? "output" : "input", autoDetected: true });
            }
            return ch;
        }
    },
    {
        // RME interfaces
        match: /rme|fireface|babyface/i,
        getChannels: (total) => {
            const ch = [];
            const half = Math.ceil(total / 2);
            for (let i = 1; i <= total; i++) {
                const isOut = i > half;
                ch.push({
                    channel: i,
                    name: isOut ? `Out ${i - half}` : `In ${i}`,
                    type: isOut ? "output" : "input",
                    autoDetected: true
                });
            }
            return ch;
        }
    },
    {
        // MOTU interfaces
        match: /motu/i,
        getChannels: (total) => {
            const ch = [];
            const half = Math.ceil(total / 2);
            for (let i = 1; i <= total; i++) {
                const isOut = i > half;
                ch.push({
                    channel: i,
                    name: isOut ? `MOTU Out ${i - half}` : `MOTU In ${i}`,
                    type: isOut ? "output" : "input",
                    autoDetected: true
                });
            }
            return ch;
        }
    },
    {
        match: /macbook|imac|mac mini|mac pro|built-in/i,
        getChannels: (total) => {
            const ch = [];
            for (let i = 1; i <= total; i++) {
                ch.push({ channel: i, name: `Built-in Mic ${i}`, type: "input", autoDetected: true });
            }
            return ch;
        }
    }
];
function autoDetectChannels(deviceName, total) {
    for (const known of KNOWN_DEVICES) {
        if (known.match.test(deviceName))
            return known.getChannels(total);
    }
    const ch = [];
    const outputStart = total > 2 ? Math.ceil(total * 0.6) + 1 : total + 1;
    for (let i = 1; i <= total; i++) {
        const isOut = i >= outputStart;
        ch.push({
            channel: i,
            name: isOut ? `Output ${i - outputStart + 1}` : `Input ${i}`,
            type: isOut ? "output" : "input",
            autoDetected: true
        });
    }
    return ch;
}
function buildChannelInfo(deviceName, total) {
    const config = loadConfig();
    const deviceConfig = config[deviceName];
    const auto = autoDetectChannels(deviceName, total);
    if (deviceConfig?.channels) {
        return auto.map(ch => {
            const override = deviceConfig.channels[String(ch.channel)];
            if (override)
                return { ...ch, ...override, autoDetected: false };
            return ch;
        });
    }
    return auto;
}
/* ---- FFMPEG CHECK (Mac only) ---- */
function checkFfmpeg() {
    const candidates = [
        "/opt/homebrew/bin/ffmpeg",
        "/usr/local/bin/ffmpeg",
        "/usr/bin/ffmpeg",
    ];
    for (const p of candidates) {
        try {
            (0, child_process_2.execSync)(`"${p}" -version`, { stdio: "ignore" });
            return true;
        }
        catch { }
    }
    try {
        (0, child_process_2.execSync)("which ffmpeg", { stdio: "ignore" });
        return true;
    }
    catch {
        return false;
    }
}
/* ---- DEVICE LISTING ---- */
function listAudioDevices() {
    return IS_MAC ? listAudioDevicesMac() : listAudioDevicesNaudiodon();
}
function listAudioDevicesMac() {
    return new Promise((resolve) => {
        const proc = (0, child_process_1.spawn)(CAPTURE_BIN, ["0", "48000", "2"], { stdio: ["ignore", "pipe", "pipe"] });
        let output = "";
        proc.stderr.on("data", (d) => { output += d.toString(); });
        setTimeout(() => { try {
            proc.kill();
        }
        catch { } }, 2000);
        proc.on("close", () => {
            const devices = [];
            const lines = output.split("\n");
            let inList = false;
            for (const line of lines) {
                if (line.trim() === "DEVICES_START") {
                    inList = true;
                    continue;
                }
                if (line.trim() === "DEVICES_END") {
                    inList = false;
                    continue;
                }
                if (inList) {
                    const m = line.match(/^DEVICE:(\d+):(.+):(\d+)$/);
                    if (m) {
                        const ch = parseInt(m[3]);
                        if (ch > 0)
                            devices.push({ index: parseInt(m[1]), name: m[2].trim(), channels: ch });
                    }
                }
            }
            console.log("🎛️  Lydenheder:", devices.map(d => `[${d.index}] ${d.name} (${d.channels}ch)`).join(", "));
            resolve(devices);
        });
    });
}
function listAudioDevicesNaudiodon() {
    return new Promise((resolve) => {
        if (!naudiodon) {
            resolve([]);
            return;
        }
        try {
            const all = naudiodon.getDevices();
            const devices = all
                .filter(d => d.maxInputChannels > 0)
                .map(d => ({ index: d.id, name: d.name, channels: d.maxInputChannels }));
            console.log("🎛️  Lydenheder (naudiodon):", devices.map(d => `[${d.index}] ${d.name} (${d.channels}ch)`).join(", "));
            resolve(devices);
        }
        catch (e) {
            console.error("naudiodon getDevices failed:", e.message);
            resolve([]);
        }
    });
}
/* ---- CAPTURE FACTORIES ---- */
function spawnMacCapture(deviceIndex, sampleRate) {
    const proc = (0, child_process_1.spawn)(CAPTURE_BIN, [
        String(deviceIndex), String(sampleRate), "30"
    ], { stdio: ["ignore", "pipe", "pipe"] });
    return {
        stdout: proc.stdout,
        stderr: proc.stderr,
        kill: (sig) => { try {
            proc.kill(sig ?? "SIGTERM");
        }
        catch { } },
        on: (event, handler) => { proc.on(event, handler); }
    };
}
function spawnNaudiodonCapture(deviceIndex, sampleRate, channelCount) {
    const stderr = new events_1.EventEmitter();
    const emitter = new events_1.EventEmitter();
    const ai = new naudiodon.AudioIO({
        inOptions: {
            channelCount,
            sampleFormat: naudiodon.SampleFormat16Bit,
            sampleRate,
            deviceId: deviceIndex,
            closeOnError: false,
            framesPerBuffer: 480
        }
    });
    // Emit synthetic protocol signals that match what the Mac binary sends to stderr,
    // so the shared capture handler below needs no platform branching at all.
    setImmediate(() => {
        stderr.emit("data", Buffer.from(`CAPTURE_START:naudiodon:${channelCount}\n`));
        setTimeout(() => stderr.emit("data", Buffer.from("CAPTURE_READY\n")), 150);
    });
    ai.on("error", (err) => emitter.emit("error", err));
    ai.on("close", () => emitter.emit("close", 0));
    ai.start();
    return {
        stdout: ai,
        stderr,
        kill: () => { try {
            ai.quit();
        }
        catch { } },
        on: (event, handler) => emitter.on(event, handler)
    };
}
/* ---- SETUP ---- */
function setupAudioCapture(io) {
    if (IS_MAC && !checkFfmpeg()) {
        console.warn("⚠️  ffmpeg ikke fundet – kør: brew install ffmpeg");
        io.on("connection", (socket) => {
            socket.on("audio:devices:list", (cb) => cb({ ok: false, error: "ffmpeg ikke installeret" }));
        });
        return;
    }
    if (!IS_MAC && !naudiodon) {
        console.warn("⚠️  naudiodon ikke tilgængelig – lydoptagelse deaktiveret");
        io.on("connection", (socket) => {
            socket.on("audio:devices:list", (cb) => cb({ ok: false, error: "naudiodon ikke installeret" }));
        });
        return;
    }
    console.log(`✅ Audio capture klar (${IS_MAC ? "macOS CoreAudio" : "Windows PortAudio/WASAPI"})`);
    io.on("connection", (socket) => {
        /* LIST DEVICES */
        socket.on("audio:devices:list", async (cb) => {
            try {
                const rawDevices = await listAudioDevices();
                if (!rawDevices.length) {
                    cb({ ok: false, error: "Ingen lydenheder fundet" });
                    return;
                }
                const devices = await Promise.all(rawDevices.map(async (d) => {
                    // Mac: channel count discovered at capture time (Apollo always 30)
                    // Windows: already known from naudiodon.getDevices()
                    const totalChannels = IS_MAC ? 30 : d.channels;
                    const channelInfo = buildChannelInfo(d.name, totalChannels);
                    return {
                        index: d.index,
                        name: d.name,
                        channels: totalChannels,
                        channelInfo,
                        sampleRate: 48000,
                        isApollo: /universal audio|apollo/i.test(d.name)
                    };
                }));
                cb({ ok: true, devices });
            }
            catch (e) {
                cb({ ok: false, error: e.message });
            }
        });
        /* START CAPTURE */
        socket.on("audio:capture:start", async ({ deviceIndex, deviceName = "", sampleRate = 48000 }, cb) => {
            stopSession(socket.id);
            console.log(`🎙️  Starter capture: device ${deviceIndex} (${deviceName}) @ ${sampleRate}Hz`);
            try {
                // Windows: look up channel count from naudiodon before starting AudioIO
                let naudiodonChannels = 2;
                if (!IS_MAC && naudiodon) {
                    try {
                        const all = naudiodon.getDevices();
                        const dev = all.find(d => d.id === deviceIndex);
                        naudiodonChannels = dev?.maxInputChannels ?? 2;
                    }
                    catch { }
                }
                const proc = IS_MAC
                    ? spawnMacCapture(deviceIndex, sampleRate)
                    : spawnNaudiodonCapture(deviceIndex, sampleRate, naudiodonChannels);
                // Mac: totalChannels updated when CAPTURE_START arrives on stderr
                // Windows: already known, but we still parse the synthetic CAPTURE_START for consistency
                let totalChannels = IS_MAC ? 2 : naudiodonChannels;
                let headerParsed = false;
                let callbackSent = false;
                let buffer = Buffer.alloc(0);
                proc.stderr.on("data", (data) => {
                    const text = data.toString();
                    const match = text.match(/CAPTURE_START:[^:]+:(\d+)/);
                    if (match && !headerParsed) {
                        totalChannels = parseInt(match[1]);
                        headerParsed = true;
                    }
                    if (text.includes("CAPTURE_READY") && !callbackSent) {
                        callbackSent = true;
                        const channelInfo = buildChannelInfo(deviceName, totalChannels);
                        const outputCount = channelInfo.filter(c => c.type === "output").length;
                        console.log(`🎙️  ${totalChannels} kanaler – ${channelInfo.filter(c => c.type === "input").length} inputs, ${outputCount} outputs`);
                        if (outputCount > 0)
                            (0, audioOutput_1.registerOutputDevice)(deviceIndex, outputCount);
                        cb?.({ ok: true, sampleRate, totalChannels, channelInfo });
                    }
                });
                setTimeout(() => {
                    if (!callbackSent) {
                        callbackSent = true;
                        const channelInfo = buildChannelInfo(deviceName, totalChannels);
                        cb?.({ ok: true, sampleRate, totalChannels, channelInfo });
                    }
                }, 2000);
                // 480 samples @ 48kHz = 10ms chunks – prevents buffer underruns
                const CHUNK_SAMPLES = 480;
                proc.stdout.on("data", (chunk) => {
                    buffer = Buffer.concat([buffer, chunk]);
                    const bytesPerSample = 2;
                    const frameSize = bytesPerSample * totalChannels;
                    const minBytes = frameSize * CHUNK_SAMPLES;
                    while (buffer.length >= minBytes) {
                        const frameCount = Math.floor(Math.min(buffer.length, minBytes * 2) / frameSize);
                        const channelBuffers = [];
                        for (let ch = 0; ch < totalChannels; ch++) {
                            const mono = Buffer.allocUnsafe(frameCount * bytesPerSample);
                            for (let f = 0; f < frameCount; f++) {
                                const srcOff = f * frameSize + ch * bytesPerSample;
                                mono[f * 2] = buffer[srcOff];
                                mono[f * 2 + 1] = buffer[srcOff + 1];
                            }
                            channelBuffers.push({ channel: ch + 1, data: mono });
                        }
                        socket.emit("audio:pcm:multi", channelBuffers);
                        buffer = buffer.slice(frameCount * frameSize);
                    }
                });
                proc.on("error", (err) => {
                    socket.emit("audio:capture:error", { error: err.message });
                    stopSession(socket.id);
                });
                proc.on("close", (code) => {
                    if (code !== 0 && code !== null)
                        socket.emit("audio:capture:error", { error: `Capture stoppet (kode ${code})` });
                    sessions.delete(socket.id);
                });
                sessions.set(socket.id, { process: proc, deviceIndex, totalChannels, sampleRate });
            }
            catch (e) {
                cb?.({ ok: false, error: e.message });
            }
        });
        /* SAVE CHANNEL CONFIG */
        socket.on("audio:channel:config:save", ({ deviceName, channelInfo }) => {
            try {
                const configPath = path.join(__dirname, "audioDeviceConfig.json");
                const config = fs.existsSync(configPath)
                    ? JSON.parse(fs.readFileSync(configPath, "utf-8"))
                    : {};
                config[deviceName] = {
                    channels: channelInfo.reduce((acc, ch) => {
                        acc[String(ch.channel)] = { name: ch.name, type: ch.type };
                        return acc;
                    }, {})
                };
                fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
                console.log(`💾 Gemt kanal-config for "${deviceName}"`);
                socket.emit("audio:channel:config:saved", { ok: true });
            }
            catch (e) {
                socket.emit("audio:channel:config:saved", { ok: false, error: e.message });
            }
        });
        socket.on("audio:capture:stop", (cb) => { stopSession(socket.id); cb?.({ ok: true }); });
        socket.on("disconnect", () => { stopSession(socket.id); });
    });
}
function stopSession(key) {
    const session = sessions.get(key);
    if (!session)
        return;
    try {
        session.process.kill("SIGTERM");
    }
    catch { }
    sessions.delete(key);
    console.log(`⏹️  Capture stopped: ${key}`);
}
//# sourceMappingURL=audioCapture.js.map