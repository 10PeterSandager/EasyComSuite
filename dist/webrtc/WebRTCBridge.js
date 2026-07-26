"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebRTCBridge = void 0;
class WebRTCBridge {
    constructor(io) {
        this.io = io;
    }
    handle(socket) {
        socket.on("webrtc_offer", (data) => {
            this.io.to(data.target).emit("webrtc_offer", data);
        });
        socket.on("webrtc_answer", (data) => {
            this.io.to(data.target).emit("webrtc_answer", data);
        });
        socket.on("webrtc_candidate", (data) => {
            this.io.to(data.target).emit("webrtc_candidate", data);
        });
    }
}
exports.WebRTCBridge = WebRTCBridge;
//# sourceMappingURL=WebRTCBridge.js.map