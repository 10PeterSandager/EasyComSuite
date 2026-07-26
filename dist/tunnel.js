"use strict";
// tunnel.ts – Cloudflare Quick Tunnel manager
// Uses the `cloudflared` npm package which downloads the binary automatically
// during `npm install`. No Cloudflare account needed.
// The tunnel gives a public https://xxx.trycloudflare.com URL that proxies
// to the local server, satisfying browsers' HTTPS requirement for getUserMedia.
Object.defineProperty(exports, "__esModule", { value: true });
exports.tunnelEvents = void 0;
exports.getTunnelUrl = getTunnelUrl;
exports.getTunnelStatus = getTunnelStatus;
exports.startTunnel = startTunnel;
exports.stopTunnel = stopTunnel;
const child_process_1 = require("child_process");
const events_1 = require("events");
let _process = null;
let _url = "";
let _status = "stopped";
exports.tunnelEvents = new events_1.EventEmitter();
function getTunnelUrl() { return _url; }
function getTunnelStatus() { return _status; }
async function startTunnel(port) {
    if (_process)
        return _url; // already running
    _status = "starting";
    _url = "";
    exports.tunnelEvents.emit("status", { status: _status, url: _url });
    return new Promise((resolve, reject) => {
        // The cloudflared npm package exposes the binary path via its `bin` export.
        // Fall back to system `cloudflared` if the package isn't installed yet.
        let binPath = "cloudflared";
        try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            binPath = require("cloudflared").bin;
        }
        catch {
            console.log("[tunnel] cloudflared npm package not found, trying system binary");
        }
        console.log(`[tunnel] starting cloudflare tunnel → http://localhost:${port}`);
        _process = (0, child_process_1.spawn)(binPath, ["tunnel", "--url", `http://localhost:${port}`], {
            stdio: ["ignore", "pipe", "pipe"],
        });
        const timeout = setTimeout(() => {
            _status = "error";
            exports.tunnelEvents.emit("status", { status: _status, url: "" });
            reject(new Error("Tunnel startup timed out after 30s"));
        }, 30000);
        // cloudflared writes the tunnel URL to stderr
        const onData = (data) => {
            const text = data.toString();
            const match = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
            if (match && !_url) {
                clearTimeout(timeout);
                _url = match[0];
                _status = "running";
                exports.tunnelEvents.emit("status", { status: _status, url: _url });
                console.log(`[tunnel] ✅ public URL: ${_url}`);
                resolve(_url);
            }
        };
        _process.stdout?.on("data", onData);
        _process.stderr?.on("data", onData);
        _process.on("exit", (code) => {
            console.log(`[tunnel] process exited (code ${code})`);
            _process = null;
            _url = "";
            _status = "stopped";
            exports.tunnelEvents.emit("status", { status: _status, url: "" });
        });
        _process.on("error", (err) => {
            clearTimeout(timeout);
            _process = null;
            _url = "";
            _status = "error";
            exports.tunnelEvents.emit("status", { status: _status, url: "" });
            console.error("[tunnel] ❌ failed to start:", err.message);
            reject(err);
        });
    });
}
function stopTunnel() {
    if (_process) {
        _process.kill();
        _process = null;
    }
    _url = "";
    _status = "stopped";
    exports.tunnelEvents.emit("status", { status: _status, url: "" });
    console.log("[tunnel] stopped");
}
//# sourceMappingURL=tunnel.js.map