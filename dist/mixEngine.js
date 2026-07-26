"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createMixBus = createMixBus;
exports.addSource = addSource;
exports.addListener = addListener;
exports.removeClient = removeClient;
exports.getListeners = getListeners;
const buses = new Map();
function createMixBus(id) {
    buses.set(id, {
        id,
        sources: new Set(),
        listeners: new Set()
    });
}
function addSource(busId, clientId) {
    const bus = buses.get(busId);
    if (!bus)
        return;
    bus.sources.add(clientId);
}
function addListener(busId, clientId) {
    const bus = buses.get(busId);
    if (!bus)
        return;
    bus.listeners.add(clientId);
}
function removeClient(clientId) {
    buses.forEach(bus => {
        bus.sources.delete(clientId);
        bus.listeners.delete(clientId);
    });
}
function getListeners(busId) {
    const bus = buses.get(busId);
    if (!bus)
        return [];
    return Array.from(bus.listeners);
}
//# sourceMappingURL=mixEngine.js.map