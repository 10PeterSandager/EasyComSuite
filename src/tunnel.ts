// tunnel.ts – Cloudflare Quick Tunnel manager
// Uses the `cloudflared` npm package which downloads the binary automatically
// during `npm install`. No Cloudflare account needed.
// The tunnel gives a public https://xxx.trycloudflare.com URL that proxies
// to the local server, satisfying browsers' HTTPS requirement for getUserMedia.

import { spawn, ChildProcess } from "child_process"
import { EventEmitter } from "events"

let _process: ChildProcess | null = null
let _url: string = ""
let _status: "stopped" | "starting" | "running" | "error" = "stopped"

export const tunnelEvents = new EventEmitter()

export function getTunnelUrl(): string { return _url }
export function getTunnelStatus() { return _status }

export async function startTunnel(port: number): Promise<string> {
  if (_process) return _url  // already running

  _status = "starting"
  _url = ""
  tunnelEvents.emit("status", { status: _status, url: _url })

  return new Promise((resolve, reject) => {
    // The cloudflared npm package exposes the binary path via its `bin` export.
    // Fall back to system `cloudflared` if the package isn't installed yet.
    let binPath = "cloudflared"
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      binPath = require("cloudflared").bin
    } catch {
      console.log("[tunnel] cloudflared npm package not found, trying system binary")
    }

    console.log(`[tunnel] starting cloudflare tunnel → http://localhost:${port}`)
    _process = spawn(binPath, ["tunnel", "--url", `http://localhost:${port}`], {
      stdio: ["ignore", "pipe", "pipe"],
    })

    const timeout = setTimeout(() => {
      _status = "error"
      tunnelEvents.emit("status", { status: _status, url: "" })
      reject(new Error("Tunnel startup timed out after 30s"))
    }, 30_000)

    // cloudflared writes the tunnel URL to stderr
    const onData = (data: Buffer) => {
      const text = data.toString()
      const match = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/)
      if (match && !_url) {
        clearTimeout(timeout)
        _url = match[0]
        _status = "running"
        tunnelEvents.emit("status", { status: _status, url: _url })
        console.log(`[tunnel] ✅ public URL: ${_url}`)
        resolve(_url)
      }
    }

    _process.stdout?.on("data", onData)
    _process.stderr?.on("data", onData)

    _process.on("exit", (code) => {
      console.log(`[tunnel] process exited (code ${code})`)
      _process = null
      _url = ""
      _status = "stopped"
      tunnelEvents.emit("status", { status: _status, url: "" })
    })

    _process.on("error", (err) => {
      clearTimeout(timeout)
      _process = null
      _url = ""
      _status = "error"
      tunnelEvents.emit("status", { status: _status, url: "" })
      console.error("[tunnel] ❌ failed to start:", err.message)
      reject(err)
    })
  })
}

export function stopTunnel() {
  if (_process) {
    _process.kill()
    _process = null
  }
  _url = ""
  _status = "stopped"
  tunnelEvents.emit("status", { status: _status, url: "" })
  console.log("[tunnel] stopped")
}
