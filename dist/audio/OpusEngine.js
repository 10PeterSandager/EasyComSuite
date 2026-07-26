"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OpusEngine = void 0;
const events_1 = require("events");
class OpusEngine extends events_1.EventEmitter {
    decode(clientId, packet) {
        const samples = new Float32Array(960);
        for (let i = 0; i < samples.length; i++) {
            samples[i] = 0;
        }
        const frame = {
            clientId,
            pcm: samples
        };
        this.emit("pcm_frame", frame);
    }
    removeClient(clientId) { }
}
exports.OpusEngine = OpusEngine;
//# sourceMappingURL=OpusEngine.js.map