"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ClusterSync = void 0;
const ws_1 = __importDefault(require("ws"));
class ClusterSync {
    constructor() {
        this.peers = [];
    }
    connect(url) {
        const ws = new ws_1.default(url);
        ws.on("open", () => {
            console.log("cluster connected", url);
        });
        ws.on("message", (msg) => {
            this.onMessage(msg.toString());
        });
        this.peers.push(ws);
    }
    broadcast(data) {
        const msg = JSON.stringify(data);
        for (const peer of this.peers) {
            if (peer.readyState === ws_1.default.OPEN) {
                peer.send(msg);
            }
        }
    }
    onMessage(msg) {
        const data = JSON.parse(msg);
        console.log("cluster state sync", data.type);
    }
}
exports.ClusterSync = ClusterSync;
//# sourceMappingURL=ClusterSync.js.map