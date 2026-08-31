"use strict";
// persist.ts – Server-side state persistence
// Saves all routing/config state to data.json so the server restores
// exactly where it left off after a restart or power failure.
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadState = loadState;
exports.scheduleSave = scheduleSave;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const DATA_FILE = path_1.default.resolve(process.cwd(), "data.json");
const EMPTY = {
    connections: [], groups: [], clients: [],
    audioRoutes: [], bridgeChannelInfo: [], outputBridgeChannels: [], streamDeckLayout: [],
    terminals: [], videoRouting: [], panelLayouts: [],
};
function loadState() {
    try {
        const raw = fs_1.default.readFileSync(DATA_FILE, "utf8");
        return { ...EMPTY, ...JSON.parse(raw) };
    }
    catch {
        return { ...EMPTY };
    }
}
// Debounced save — writes at most once per second regardless of how often called
let _saveTimer = null;
function scheduleSave(getState) {
    if (_saveTimer)
        clearTimeout(_saveTimer);
    _saveTimer = setTimeout(() => {
        _saveTimer = null;
        try {
            fs_1.default.writeFileSync(DATA_FILE, JSON.stringify(getState(), null, 2), "utf8");
        }
        catch (e) {
            console.warn("[persist] Could not write data.json:", e);
        }
    }, 1000);
}
//# sourceMappingURL=persist.js.map