import { spawn, ChildProcess } from "child_process"
import { EventEmitter } from "events"

let _process: ChildProcess | null = null
let _url: string = ""
let _status: "stopped" | "starting" | "running" | "error" = "stopped"

export const tunnelEvents = new EventEmitter()

export function getTunnelUrl(): string { return _url }
export function getTunnelStatus() { return _status }

export async function startTunnel(port: number): Promise<string> {
  if (_process) return _url

  _status = "starting"
  _url = ""
  tunnelEvents.emit("status", { status: _status, url: _url })

  return new Promise((resolve, reject) => {
    let binPath = "cloudflared"
    try {
      binPath = require("cloudflared").bin
    } catch {
      console.log("[tunnel] cloudflared npm package not found, trying system binary")
    }

    const token = process.env.CLOUDFLARE_TUNNEL_TOKEN
    const staticUrl = process.env.CLOUDFLARE_TUNNEL_URL

    if (token && staticUrl) {
      // Named tunnel with static URL — token authenticates, URL is known upfront
      console.log(`[tunnel] starting named tunnel → ${staticUrl}`)
      _process = spawn(binPath, ["tunnel", "run", "--token", token], {
        stdio: ["ignore", "pipe", "pipe"],
      })

      const timeout = setTimeout(() => {
        _status = "error"
        tunnelEvents.emit("status", { status: _status, url: "" })
        reject(new Error("Tunnel startup timed out after 30s"))
      }, 30_000)

      const onData = (data: Buffer) => {
        const text = data.toString()
        // Named tunnel is ready when it registers with Cloudflare
        if (text.includes("Registered tunnel connection") || text.includes("Connection") && text.includes("registered")) {
          clearTimeout(timeout)
          _url = staticUrl
          _status = "running"
          tunnelEvents.emit("status", { status: _status, url: _url })
          console.log(`[tunnel] ✅ static URL: ${_url}`)
          resolve(_url)
        }
      }

      _process.stdout?.on("data", onData)
      _process.stderr?.on("data", onData)

      // Named tunnel: also resolve after 8s if no explicit ready signal
      // (cloudflared output varies by version)
      const fallbackReady = setTimeout(() => {
        if (_status === "starting") {
          _url = staticUrl
          _status = "running"
          tunnelEvents.emit("status", { status: _status, url: _url })
          console.log(`[tunnel] ✅ static URL (assumed ready): ${_url}`)
          resolve(_url)
        }
      }, 8_000)
      _process.on("exit", () => clearTimeout(fallbackReady))

    } else {
      // Quick tunnel — dynamic trycloudflare.com URL
      console.log(`[tunnel] starting quick tunnel → http://localhost:${port}`)
      _process = spawn(binPath, ["tunnel", "--url", `http://localhost:${port}`], {
        stdio: ["ignore", "pipe", "pipe"],
      })

      const timeout = setTimeout(() => {
        _status = "error"
        tunnelEvents.emit("status", { status: _status, url: "" })
        reject(new Error("Tunnel startup timed out after 30s"))
      }, 30_000)

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
    }

    _process!.on("exit", (code) => {
      console.log(`[tunnel] process exited (code ${code})`)
      _process = null
      _url = ""
      _status = "stopped"
      tunnelEvents.emit("status", { status: _status, url: "" })
    })

    _process!.on("error", (err) => {
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
