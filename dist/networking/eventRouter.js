"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerEventHandlers = registerEventHandlers;
function registerEventHandlers(socket) {
    /* =========================
       CLIENT REGISTER
    ========================= */
    socket.on("register", (data) => {
        console.log("client registered:", data.id);
    });
    /* =========================
       TALK BUTTON
    ========================= */
    socket.on("talk", (data) => {
        console.log("talk:", data.id, data.state);
    });
    /* =========================
       MATRIX ROUTING
    ========================= */
    socket.on("matrix_route", (data) => {
        console.log("matrix route:", data);
    });
    /* =========================
       OPUS AUDIO FRAME
    ========================= */
    socket.on("opus_frame", (data) => {
        console.log("audio frame from:", data.clientId);
    });
    /* =========================
       DISCONNECT
    ========================= */
    socket.on("disconnect", () => {
        console.log("client disconnected:", socket.id);
    });
}
//# sourceMappingURL=eventRouter.js.map