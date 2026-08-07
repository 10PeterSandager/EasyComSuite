"use strict";
// tunnel.ts – Cloudflare Tunnel manager
// Named tunnel (token): uses CLOUDFLARE_TUNNEL_TOKEN + CLOUDFLARE_TUNNEL_URL → static URL
// Quick tunnel (fallback): no token, generates a random *.trycloudflare.com URL each restart
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
        return _url;
    _status = "starting";
    _url = "";
    exports.tunnelEvents.emit("status", { status: _status, url: _url });
    const token = process.env.CLOUDFLARE_TUNNEL_TOKEN;
    const staticUrl = process.env.CLOUDFLARE_TUNNEL_URL;
    return new Promise((resolve, reject) => {
        let binPath = "cloudflared";
        try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            binPath = require("cloudflared").bin;
        }
        catch {
            console.log("[tunnel] cloudflared npm package not found, trying system binary");
        }
        let args;
        if (token) {
            console.log(`[tunnel] starting named tunnel → ${staticUrl ?? "(URL from Cloudflare dashboard)"}`);
            args = ["tunnel", "--no-autoupdate", "run", "--token", token];
        }
        else {
            console.log(`[tunnel] starting quick tunnel → http://localhost:${port}`);
            args = ["tunnel", "--url", `http://localhost:${port}`];
        }
        _process = (0, child_process_1.spawn)(binPath, args, { stdio: ["ignore", "pipe", "pipe"] });
        const timeout = setTimeout(() => {
            _status = "error";
            exports.tunnelEvents.emit("status", { status: _status, url: "" });
            reject(new Error("Tunnel startup timed out after 30s"));
        }, 30000);
        if (token && staticUrl) {
            // Named tunnel: URL is fixed. Resolve as soon as cloudflared produces any output
            // (meaning the process started and is connecting). The URL never changes.
            let resolved = false;
            const onStartup = () => {
                if (resolved)
                    return;
                resolved = true;
                clearTimeout(timeout);
                _url = staticUrl;
                _status = "running";
                exports.tunnelEvents.emit("status", { status: _status, url: _url });
                console.log(`[tunnel] ✅ named tunnel running: ${_url}`);
                resolve(_url);
            };
            _process.stdout?.on("data", onStartup);
            _process.stderr?.on("data", onStartup);
            // Fallback: resolve after 5s even if cloudflared is silent
            setTimeout(onStartup, 5000);
        }
        else {
            // Quick tunnel: wait for trycloudflare.com URL to appear in output
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
        }
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