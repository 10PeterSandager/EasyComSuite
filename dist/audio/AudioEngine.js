"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createBus = createBus;
exports.subscribe = subscribe;
exports.publish = publish;
exports.unsubscribe = unsubscribe;
exports.getListeners = getListeners;
const buses = new Map();
function createBus(id, type) {
    buses.set(id, {
        id,
        type,
        listeners: new Set(),
        sources: new Set()
    });
}
function subscribe(busId, clientId) {
    const bus = buses.get(busId);
    if (!bus)
        return;
    bus.listeners.add(clientId);
}
function publish(busId, clientId) {
    const bus = buses.get(busId);
    if (!bus)
        return;
    bus.sources.add(clientId);
}
function unsubscribe(busId, clientId) {
    const bus = buses.get(busId);
    if (!bus)
        return;
    bus.listeners.delete(clientId);
    bus.sources.delete(clientId);
}
function getListeners(busId) {
    const bus = buses.get(busId);
    if (!bus)
        return [];
    return Array.from(bus.listeners);
}
//# sourceMappingURL=AudioEngine.js.map