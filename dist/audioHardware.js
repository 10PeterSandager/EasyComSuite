"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerDevice = registerDevice;
exports.getDevices = getDevices;
const devices = [];
function registerDevice(device) {
    devices.push(device);
}
function getDevices() {
    return devices;
}
//# sourceMappingURL=audioHardware.js.map