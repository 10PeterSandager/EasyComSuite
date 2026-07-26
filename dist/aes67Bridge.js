"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createStream = createStream;
exports.sendAudio = sendAudio;
const dgram_1 = __importDefault(require("dgram"));
const streams = new Map();
const socket = dgram_1.default.createSocket("udp4");
function createStream(id, address, port) {
    streams.set(id, {
        id,
        address,
        port
    });
}
function sendAudio(streamId, audio) {
    const stream = streams.get(streamId);
    if (!stream)
        return;
    socket.send(audio, stream.port, stream.address);
}
//# sourceMappingURL=aes67Bridge.js.map