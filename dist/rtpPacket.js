"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildRtpPacket = buildRtpPacket;
function buildRtpPacket(payload, sequence, timestamp, ssrc) {
    const header = Buffer.alloc(12);
    header[0] = 0x80;
    header[1] = 96;
    header.writeUInt16BE(sequence, 2);
    header.writeUInt32BE(timestamp, 4);
    header.writeUInt32BE(ssrc, 8);
    return Buffer.concat([header, payload]);
}
//# sourceMappingURL=rtpPacket.js.map