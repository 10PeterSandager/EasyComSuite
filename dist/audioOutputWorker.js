"use strict";
/**
 * audioOutputWorker.ts
 *
 * Spawned as a child process by audioOutput.ts so naudiodon/PortAudio
 * SIGSEGV cannot kill the main server.
 *
 * Args: node audioOutputWorker.js <deviceId> <deviceChannels> <hwChannel>
 *
 * Protocol:
 *   stdout: "READY:<port>\n"  when UDP socket + AudioIO are ready
 *           "ERROR:<msg>\n"   on failure
 *   stdin:  "stop\n"          triggers cleanup and exit
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
const dgram = __importStar(require("dgram"));
let OpusScript;
let naudiodon;
try {
    OpusScript = require("opusscript");
}
catch { }
try {
    naudiodon = require("naudiodon");
}
catch { }
const deviceId = parseInt(process.argv[2]);
const deviceChannels = parseInt(process.argv[3]);
const hwChannel = parseInt(process.argv[4]);
const chIdx = (hwChannel - 1) % deviceChannels;
if (!OpusScript || !naudiodon) {
    process.stdout.write(`ERROR:missing opusscript or naudiodon\n`);
    process.exit(1);
}
if (isNaN(deviceId) || isNaN(deviceChannels) || deviceChannels < 1 || isNaN(hwChannel)) {
    process.stdout.write(`ERROR:invalid args: ${process.argv.slice(2).join(" ")}\n`);
    process.exit(1);
}
const rtpSocket = dgram.createSocket("udp4");
rtpSocket.bind(0, "127.0.0.1", () => {
    const port = rtpSocket.address().port;
    let audioStream;
    try {
        audioStream = new naudiodon.AudioIO({
            outOptions: {
                channelCount: deviceChannels,
                sampleFormat: naudiodon.SampleFormat16Bit,
                sampleRate: 48000,
                deviceId,
                closeOnError: false,
            },
        });
        audioStream.start();
    }
    catch (e) {
        process.stdout.write(`ERROR:AudioIO: ${e?.message ?? e}\n`);
        process.exit(1);
    }
    process.stdout.write(`READY:${port}\n`);
    const decoder = new OpusScript(48000, 1);
    const FRAME_SIZE = 960;
    rtpSocket.on("message", (msg) => {
        try {
            if (msg.length < 12)
                return;
            const cc = msg[0] & 0x0f;
            const hasExt = (msg[0] & 0x10) !== 0;
            let hdrLen = 12 + cc * 4;
            if (hasExt && msg.length > hdrLen + 4) {
                hdrLen += 4 + msg.readUInt16BE(hdrLen + 2) * 4;
            }
            const hasPad = (msg[0] & 0x20) !== 0;
            let end = msg.length;
            if (hasPad && end > hdrLen)
                end -= msg[end - 1];
            const payload = msg.slice(hdrLen, end);
            if (!payload.length)
                return;
            const pcm = decoder.decode(payload, FRAME_SIZE);
            const outBuf = Buffer.allocUnsafe(pcm.length * deviceChannels * 2);
            for (let i = 0; i < pcm.length; i++) {
                for (let c = 0; c < deviceChannels; c++) {
                    outBuf.writeInt16LE(c === chIdx ? pcm[i] : 0, (i * deviceChannels + c) * 2);
                }
            }
            audioStream.write(outBuf);
        }
        catch { }
    });
    const cleanup = () => {
        try {
            audioStream.quit();
        }
        catch { }
        try {
            rtpSocket.close();
        }
        catch { }
        process.exit(0);
    };
    let stdinBuf = "";
    process.stdin.on("data", (d) => {
        stdinBuf += d.toString();
        if (stdinBuf.includes("stop"))
            cleanup();
    });
    process.on("SIGTERM", cleanup);
    process.on("SIGINT", cleanup);
});
//# sourceMappingURL=audioOutputWorker.js.map