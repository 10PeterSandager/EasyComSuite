"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildRoutingForClient = buildRoutingForClient;
const connections_1 = require("./connections");
function buildRoutingForClient(clientId) {
    const connections = (0, connections_1.getConnectionsForTarget)(clientId);
    const map = {};
    for (const conn of connections) {
        if (!map[conn.channel]) {
            map[conn.channel] = [];
        }
        map[conn.channel].push(conn.from);
    }
    return map;
}
//# sourceMappingURL=router.js.map