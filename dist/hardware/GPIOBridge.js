"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.GPIOBridge = void 0;
const dgram_1 = __importDefault(require("dgram"));
class GPIOBridge {
    constructor() {
        this.socket = dgram_1.default.createSocket("udp4");
        this.configs = new Map();
    }
    register(config) {
        this.configs.set(config.id, config);
    }
    trigger(id, message = "CMD_BT_ON") {
        const cfg = this.configs.get(id);
        if (!cfg)
            return;
        const buf = Buffer.from(message);
        this.socket.send(buf, cfg.port, cfg.ip);
    }
    release(id) {
        const cfg = this.configs.get(id);
        if (!cfg)
            return;
        const buf = Buffer.from("CMD_BT_OFF");
        this.socket.send(buf, cfg.port, cfg.ip);
    }
}
exports.GPIOBridge = GPIOBridge;
//# sourceMappingURL=GPIOBridge.js.map