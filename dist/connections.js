"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.addConnection = addConnection;
exports.removeConnection = removeConnection;
exports.getConnections = getConnections;
exports.getConnectionsForTarget = getConnectionsForTarget;
const connections = [];
function addConnection(conn) {
    const exists = connections.find(c => c.from === conn.from &&
        c.to === conn.to &&
        c.channel === conn.channel);
    if (exists)
        return;
    connections.push(conn);
}
function removeConnection(conn) {
    const index = connections.findIndex(c => c.from === conn.from &&
        c.to === conn.to &&
        c.channel === conn.channel);
    if (index !== -1)
        connections.splice(index, 1);
}
function getConnections() {
    return connections;
}
function getConnectionsForTarget(clientId) {
    return connections.filter(c => c.to === clientId);
}
//# sourceMappingURL=connections.js.map