"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.addClient = addClient;
exports.removeClient = removeClient;
exports.getClient = getClient;
exports.getAllClients = getAllClients;
const clients = new Map();
function addClient(client) {
    clients.set(client.id, client);
}
function removeClient(id) {
    clients.delete(id);
}
function getClient(id) {
    return clients.get(id);
}
function getAllClients() {
    return Array.from(clients.values());
}
//# sourceMappingURL=stateStore.js.map