"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createSocketServer = createSocketServer;
const socket_io_1 = require("socket.io");
const eventRouter_1 = require("./eventRouter");
function createSocketServer(httpServer) {
    const io = new socket_io_1.Server(httpServer, {
        cors: {
            origin: "*"
        }
    });
    io.on("connection", (socket) => {
        (0, eventRouter_1.registerEventHandlers)(socket);
    });
    return io;
}
//# sourceMappingURL=socketServer.js.map