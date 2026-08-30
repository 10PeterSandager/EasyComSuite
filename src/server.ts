import "dotenv/config"
import express from "express"
import http from "http"
import https from "https"
import fs from "fs"
import path from "path"
import os from "os"
import { Server } from "socket.io"

import { setupSignaling, streamDeckManager, clearAllConnections, getDebugState, factoryReset, getPersistedState, applyBackupState } from "./signaling"
import { setupBackupRoutes } from "./backup"
import { initMediasoup } from "./mediasoup"
import { setupAudioCapture } from "./audioCapture"
import { startTunnel, tunnelEvents, getTunnelUrl, getTunnelStatus } from "./tunnel"

/* ---------- EXPRESS ---------- */

const app = express()
app.use(express.json())

// Allow cross-origin requests from any origin (required for internet clients)
app.use((_, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*")
  res.setHeader("Access-Control-Allow-Headers", "Content-Type")
  next()
})

// Serve easycom-remote as static files at /remote
// Build it first: cd easycom-remote && npm run build
const remoteDist = path.join(__dirname, "../../../easycom-remote/dist")
if (fs.existsSync(remoteDist)) {
  app.use("/remote", express.static(remoteDist))
  app.get("/remote/{*splat}", (_, res) => res.sendFile(path.join(remoteDist, "index.html")))
  console.log("📱 Remote app served at /remote")
}

// Serve easycom-desktop at /desktop
const desktopDist = path.join(__dirname, "../../../easycom-desktop/dist")
if (fs.existsSync(desktopDist)) {
  app.use("/desktop", express.static(desktopDist))
  app.get("/desktop/{*splat}", (_, res) => res.sendFile(path.join(desktopDist, "index.html")))
  console.log("🖥️  Desktop app served at /desktop")
}

// Serve easycom-broadcast-intercom (host UI) at /host
const hostDist = path.join(__dirname, "../../../easycom-broadcast-intercom/dist")
if (fs.existsSync(hostDist)) {
  app.use("/host", express.static(hostDist))
  app.get("/host/{*splat}", (_, res) => res.sendFile(path.join(hostDist, "index.html")))
  console.log("🎛️  Host app served at /host")
}

app.get("/", (_, res) => {
  res.send("EasyCom Server Running")
})

app.get("/health", (_, res) => {
  res.json({ status: "ok" })
})

// Returns current Cloudflare Tunnel status and URL
app.get("/api/tunnel", (_, res) => {
  res.json({ status: getTunnelStatus(), url: getTunnelUrl() })
})

// Returns LAN IP and HTTPS port so the host UI can build QR codes for local access
app.get("/api/network", (_, res) => {
  const nets = os.networkInterfaces()
  let lanIp = "127.0.0.1"
  for (const ifaces of Object.values(nets)) {
    for (const iface of ifaces ?? []) {
      if (iface.family === "IPv4" && !iface.internal) { lanIp = iface.address; break }
    }
    if (lanIp !== "127.0.0.1") break
  }
  const httpsPort = parseInt(process.env.PORT ?? "3000")
  res.json({ lanIp, lanPort: httpsPort })
})

// Dynamic QR code page — always shows the current tunnel URL
// Open http://localhost:3000/qr on the host, then scan with the tablet
app.get("/qr", (_, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8")
  res.send(`<!DOCTYPE html>
<html lang="da">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>EasyCom Remote — QR</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:#111;color:#eee;font-family:system-ui,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;gap:20px;padding:24px}
  h1{color:#f97316;font-size:1.5rem;font-weight:900;letter-spacing:-.02em}
  #status{font-size:.85rem;color:#94a3b8;text-align:center}
  #qr-wrap{background:#fff;padding:16px;border-radius:12px;display:none}
  #url{color:#f97316;font-size:.8rem;word-break:break-all;text-align:center;max-width:320px}
  .dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:#f97316;animation:pulse 1s ease-in-out infinite}
  @keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
</style>
</head>
<body>
<h1>EASYC<span style="color:#f97316">O</span>M Remote</h1>
<p id="status"><span class="dot"></span> Starter tunnel…</p>
<div id="qr-wrap"><div id="qr"></div></div>
<p id="url"></p>
<script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js" crossorigin="anonymous"></script>
<script>
  let qrInstance = null
  async function poll() {
    try {
      const r = await fetch('/api/tunnel')
      const d = await r.json()
      if (d.status === 'running' && d.url) {
        document.getElementById('status').textContent = 'Scan med tablet for at åbne Remote'
        document.getElementById('url').textContent = d.url + '/remote'
        document.getElementById('qr-wrap').style.display = 'block'
        if (!qrInstance) {
          qrInstance = new QRCode(document.getElementById('qr'), {
            text: d.url + '/remote',
            width: 260, height: 260,
            colorDark: '#000', colorLight: '#fff',
            correctLevel: QRCode.CorrectLevel.H
          })
        }
        return
      } else if (d.status === 'error') {
        document.getElementById('status').textContent = '❌ Tunnel fejlede — tjek netværk og prøv igen'
        return
      } else {
        document.getElementById('status').innerHTML = '<span class="dot"></span> Starter tunnel…'
      }
    } catch(e) {
      document.getElementById('status').innerHTML = '<span class="dot"></span> Forbinder til server…'
    }
    setTimeout(poll, 2000)
  }
  poll()
</script>
</body>
</html>`)
})

// Serve SSL cert for device trust installation (iOS: open in Safari → install profile)
app.get("/cert", (_, res) => {
  const certPath = process.env.SSL_CERT_PATH
  if (!certPath || !fs.existsSync(certPath)) {
    res.status(404).send("No certificate configured")
    return
  }
  res.setHeader("Content-Type", "application/x-x509-ca-cert")
  res.setHeader("Content-Disposition", 'attachment; filename="easycom.crt"')
  res.sendFile(path.resolve(certPath))
})

// Returns ICE server config to clients so they can reach the server across NAT.
// Set TURN_URL / TURN_USERNAME / TURN_PASSWORD env vars for a TURN relay server.
app.get("/api/ice-config", (_, res) => {
  const iceServers: any[] = [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ]
  const rawTurn = process.env.TURN_URL
  if (rawTurn) {
    const turnUrl = /^(turn:|turns:|stun:)/i.test(rawTurn) ? rawTurn : `turn:${rawTurn}`
    iceServers.push({
      urls: turnUrl,
      username: process.env.TURN_USERNAME ?? "",
      credential: process.env.TURN_PASSWORD ?? "",
    })
  }
  res.json({ iceServers })
})

// Read .env into a key/value map
function readEnv(envPath: string): Record<string, string> {
  if (!fs.existsSync(envPath)) return {}
  const map: Record<string, string> = {}
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^([^#=][^=]*)=(.*)$/)
    if (m) map[m[1].trim()] = m[2].trim()
  }
  return map
}

function writeEnv(envPath: string, map: Record<string, string>) {
  fs.writeFileSync(envPath, Object.entries(map).map(([k, v]) => `${k}=${v}`).join("\n") + "\n")
}

const envPath = path.join(__dirname, "../.env")

app.get("/api/remote-url", (_, res) => {
  const tunnelUrl = getTunnelUrl()
  if (tunnelUrl) return res.json({ url: `${tunnelUrl}/remote` })
  const e = readEnv(envPath)
  const domain = e.HOST_DOMAIN ?? ""
  const port   = process.env.PORT ?? "3000"
  const url    = domain ? `https://${domain}:${port}/remote` : ""
  res.json({ url })
})

// Returns config status + non-secret field values
app.get("/api/config", (_, res) => {
  const e = readEnv(envPath)
  res.json({
    isConfigured: !!e.MEDIASOUP_ANNOUNCED_IP,
    ip:            e.MEDIASOUP_ANNOUNCED_IP ?? "",
    turnUrl:       e.TURN_URL ?? "",
    turnUsername:  e.TURN_USERNAME ?? "",
    hasTurnPass:   !!e.TURN_PASSWORD,
    hasSessionPw:  !!e.SESSION_PASSWORD,
    hasSsl:        !!(e.SSL_CERT_PATH && e.SSL_KEY_PATH),
    sslCertPath:   e.SSL_CERT_PATH ?? "",
    sslKeyPath:    e.SSL_KEY_PATH ?? "",
  })
})

// Writes fields to .env and restarts the server process
app.post("/api/config", (req, res) => {
  const body = req.body as Record<string, string>
  const e = readEnv(envPath)
  const allowed = ["MEDIASOUP_ANNOUNCED_IP","TURN_URL","TURN_USERNAME","TURN_PASSWORD","SESSION_PASSWORD","SSL_CERT_PATH","SSL_KEY_PATH","PORT"]
  for (const key of allowed) {
    const bodyKey = ({
      MEDIASOUP_ANNOUNCED_IP: "ip",
      TURN_URL: "turnUrl",
      TURN_USERNAME: "turnUsername",
      TURN_PASSWORD: "turnPassword",
      SESSION_PASSWORD: "sessionPassword",
      SSL_CERT_PATH: "sslCertPath",
      SSL_KEY_PATH: "sslKeyPath",
    } as Record<string, string>)[key] ?? key.toLowerCase()
    if (body[bodyKey] !== undefined) e[key] = body[bodyKey]
  }
  writeEnv(envPath, e)
  res.json({ ok: true })
  setTimeout(() => process.exit(0), 400)
})

app.get("/admin/clear-connections", (_, res) => {
  clearAllConnections(io)
  res.json({ ok: true })
})

app.post("/admin/factory-reset", (_, res) => {
  factoryReset(io)
  res.json({ ok: true })
})

app.get("/debug/state", (_, res) => {
  res.json(getDebugState())
})

app.get("/debug", (_, res) => {
  res.setHeader("Content-Type", "text/html")
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>EasyCom Diagnostic</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0 }
  body { background: #0d0d0d; color: #e5e7eb; font-family: 'Courier New', monospace; font-size: 13px; padding: 16px }
  h1 { color: #f97316; margin-bottom: 16px; font-size: 18px }
  h2 { color: #94a3b8; font-size: 12px; text-transform: uppercase; letter-spacing: .1em; margin-bottom: 8px; margin-top: 20px }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px }
  .card { background: #1c1c1e; border: 1px solid #2d2d2f; border-radius: 8px; padding: 12px }
  .card.full { grid-column: 1 / -1 }
  table { width: 100%; border-collapse: collapse }
  th { color: #64748b; font-weight: normal; text-align: left; padding: 4px 8px; border-bottom: 1px solid #2d2d2f; font-size: 11px }
  td { padding: 4px 8px; border-bottom: 1px solid #1a1a1c; font-size: 12px }
  .ok { color: #22c55e }
  .warn { color: #f97316 }
  .err { color: #ef4444 }
  .dim { color: #52525b }
  .tag { display: inline-block; padding: 1px 5px; border-radius: 3px; font-size: 10px; margin: 1px }
  .tag-green { background: #14532d; color: #86efac }
  .tag-red { background: #450a0a; color: #fca5a5 }
  .tag-blue { background: #1e3a5f; color: #93c5fd }
  .tag-orange { background: #431407; color: #fdba74 }
  .stat { display: inline-block; margin-right: 24px }
  .stat-val { font-size: 22px; font-weight: bold; color: #f97316 }
  .stat-label { font-size: 10px; color: #52525b; display: block }
  #log { height: 200px; overflow-y: auto; background: #0a0a0a; border-radius: 4px; padding: 8px }
  #log div { padding: 1px 0; color: #94a3b8; font-size: 11px }
  #log .log-warn { color: #f97316 }
  #log .log-err { color: #ef4444 }
  #ts { color: #374151; font-size: 10px; float: right }
  .pulse { animation: pulse 1s infinite }
  @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.4} }
</style>
</head>
<body>
<h1>&#127475; EasyCom Diagnostic <span id="ts"></span></h1>

<div id="stats" style="margin-bottom:20px"></div>

<div class="grid">
  <div class="card full">
    <h2>Connections</h2>
    <table>
      <thead><tr><th>From</th><th>To</th><th>Ch</th><th>ToCh</th><th>Status</th></tr></thead>
      <tbody id="tbl-conn"></tbody>
    </table>
  </div>
  <div class="card">
    <h2>Producers</h2>
    <table>
      <thead><tr><th>Client ID</th><th>Producer ID</th></tr></thead>
      <tbody id="tbl-prod"></tbody>
    </table>
  </div>
  <div class="card">
    <h2>Clients</h2>
    <table>
      <thead><tr><th>ID</th><th>Name</th><th>Type</th><th>Status</th></tr></thead>
      <tbody id="tbl-clients"></tbody>
    </table>
  </div>
  <div class="card full">
    <h2>Mobile TB State (mobileActiveTb)</h2>
    <div id="tb-state" style="padding:4px 0"></div>
  </div>
  <div class="card full">
    <h2>Event Log</h2>
    <div id="log"></div>
  </div>
</div>

<script>
let prev = null
const log = document.getElementById('log')

function addLog(msg, cls='') {
  const d = document.createElement('div')
  d.textContent = new Date().toLocaleTimeString() + '  ' + msg
  if (cls) d.className = 'log-' + cls
  log.prepend(d)
  while (log.children.length > 200) log.removeChild(log.lastChild)
}

function render(s) {
  document.getElementById('ts').textContent = 'updated ' + new Date().toLocaleTimeString()

  // Stats
  const st = s.stats
  document.getElementById('stats').innerHTML =
    ['totalConnections','effectiveConnections','suppressedConnections','producers','clients','mobilesTransmitting']
    .map(k => \`<span class="stat"><span class="stat-val \${k==='suppressedConnections'&&st[k]>0?'err':k==='mobilesTransmitting'&&st[k]>0?'warn':''}">\${st[k]}</span><span class="stat-label">\${k}</span></span>\`)
    .join('')

  // Connections table
  document.getElementById('tbl-conn').innerHTML = s.connections.map(c => {
    const cls = c.effective ? 'ok' : 'err'
    const badge = c.effective
      ? '<span class="tag tag-green">ACTIVE</span>'
      : '<span class="tag tag-red">BLOCKED</span>'
    const toCh = c.toChannel != null ? c.toChannel : '<span class="dim">–</span>'
    return \`<tr><td class="\${cls}">\${c.from}</td><td class="\${cls}">\${c.to}</td><td>\${c.channel}</td><td>\${toCh}</td><td>\${badge}</td></tr>\`
  }).join('') || '<tr><td colspan="5" class="dim">No connections</td></tr>'

  // Producers
  document.getElementById('tbl-prod').innerHTML = s.producers.map(p =>
    \`<tr><td class="ok">\${p.id}</td><td class="dim" style="font-size:10px">\${p.producerId.slice(0,16)}…</td></tr>\`
  ).join('') || '<tr><td colspan="2" class="dim">None</td></tr>'

  // Clients
  document.getElementById('tbl-clients').innerHTML = s.clients.map(c => {
    const scls = c.status === 'online' ? 'ok' : 'dim'
    return \`<tr><td>\${c.id}</td><td>\${c.name}</td><td><span class="tag tag-blue">\${c.type}</span></td><td class="\${scls}">\${c.status}</td></tr>\`
  }).join('') || '<tr><td colspan="4" class="dim">None</td></tr>'

  // TB state
  const tbEl = document.getElementById('tb-state')
  if (s.mobileActiveTb.length === 0) {
    tbEl.innerHTML = '<span class="dim">No mobile clients tracked</span>'
  } else {
    tbEl.innerHTML = s.mobileActiveTb.map(m => {
      const active = m.activeChannels.length > 0
      const channels = active
        ? m.activeChannels.map(ch => \`<span class="tag tag-orange">TB\${ch}</span>\`).join('')
        : '<span class="dim">idle</span>'
      return \`<div style="margin-bottom:4px"><span class="\${active?'warn':'dim'}">\${m.clientId}</span> → \${channels}</div>\`
    }).join('')
  }

  // Diff log
  if (prev) {
    const prevEffective = new Set(prev.connections.filter(c=>c.effective).map(c=>c.from+'→'+c.to+':'+c.channel))
    const nowEffective = new Set(s.connections.filter(c=>c.effective).map(c=>c.from+'→'+c.to+':'+c.channel))
    for (const k of nowEffective) if (!prevEffective.has(k)) addLog('▶ ACTIVE: ' + k)
    for (const k of prevEffective) if (!nowEffective.has(k)) addLog('✕ BLOCKED: ' + k, 'warn')
    const prevTb = JSON.stringify(prev.mobileActiveTb)
    const nowTb = JSON.stringify(s.mobileActiveTb)
    if (prevTb !== nowTb) addLog('TB state changed: ' + nowTb, 'warn')
    if (prev.stats.producers !== s.stats.producers) addLog('Producers changed: ' + s.stats.producers)
    if (prev.stats.clients !== s.stats.clients) addLog('Clients changed: ' + s.stats.clients)
  } else {
    addLog('Connected to diagnostic endpoint')
  }

  prev = s
}

async function poll() {
  try {
    const r = await fetch('/debug/state')
    const s = await r.json()
    render(s)
  } catch(e) {
    addLog('Fetch error: ' + e.message, 'err')
  }
  setTimeout(poll, 1000)
}

poll()
</script>
</body>
</html>`)
})

/* ---------- HTTP / HTTPS SERVER ---------- */

// If SSL_CERT_PATH and SSL_KEY_PATH are set, serve HTTPS.
// This is required for internet clients — browsers block getUserMedia() on non-localhost HTTP.
// Alternative: run HTTP on 3000 behind an nginx/Caddy reverse proxy that handles TLS.
const sslCert = process.env.SSL_CERT_PATH
const sslKey  = process.env.SSL_KEY_PATH

const server = (sslCert && sslKey)
  ? https.createServer({ cert: fs.readFileSync(sslCert), key: fs.readFileSync(sslKey) }, app)
  : http.createServer(app)

// Local HTTP server for LAN clients (phones/tablets) that can't trust the SSL cert.
// Shares the same Express app and Socket.IO instance — no SSL issues on local network.
const localHttpServer = (sslCert && sslKey) ? http.createServer(app) : null

const isHttps = sslCert && sslKey

/* ---------- SOCKET ---------- */

const ioServers = localHttpServer ? [server, localHttpServer] : [server]
const io = new Server(server, {
  path: '/io',
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
})
if (localHttpServer) io.attach(localHttpServer)

// Session password middleware — checked on every connection before any events.
// If SESSION_PASSWORD is set in .env, clients must supply it in socket auth.
// An empty / unset password means the server is open (backwards compatible).
io.use((socket, next) => {
  const required = process.env.SESSION_PASSWORD
  if (!required) return next()

  // Trust connections from localhost — the HOST app running on this machine
  const addr = socket.handshake.address
  if (addr === "127.0.0.1" || addr === "::1" || addr === "::ffff:127.0.0.1") return next()

  const provided = socket.handshake.auth?.sessionPassword
  if (provided === required) return next()
  console.log(`[auth] rejected connection from ${addr} — wrong session password`)
  next(new Error("Wrong session password"))
})

/* ---------- START FUNCTION ---------- */

async function start() {

  try {

    console.log("🚀 Starting EasyCom Server...")

    /* MEDIASOUP */
    await initMediasoup()
    console.log("✅ Mediasoup ready")

    /* SIGNALING */
    setupSignaling(io)
    console.log("✅ Signaling ready")

    /* BACKUP / FAILOVER */
    setupBackupRoutes(app, io, getPersistedState, applyBackupState)
    console.log("✅ Backup failover ready")

    /* AUDIO CAPTURE BRIDGE */
    setupAudioCapture(io)
    console.log("✅ Audio capture bridge ready")

    const PORT = parseInt(process.env.PORT ?? "3000")
    const protocol = isHttps ? "https" : "http"

    server.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        console.error(`❌ Port ${PORT} already in use — another server instance is running. Exiting.`)
        process.exit(1)
      } else {
        console.error("❌ Server error:", err.message)
      }
    })

    server.listen(PORT, "0.0.0.0", () => {
      console.log(`🔥 Server running on ${protocol}://0.0.0.0:${PORT}`)

      // Broadcast tunnel status changes to all connected HOST UIs
      tunnelEvents.on("status", (state) => {
        io.emit("tunnel:status", state)
      })

      // Auto-start Cloudflare Tunnel if enabled in .env (CLOUDFLARE_TUNNEL=true)
      if (process.env.CLOUDFLARE_TUNNEL === "true") {
        startTunnel(PORT)
          .then(url => console.log(`🌐 Cloudflare Tunnel: ${url}`))
          .catch(err => console.error("❌ Tunnel failed:", err.message))
      }
    })

    // LAN HTTP server — phones/tablets on local network connect here (no SSL cert needed)
    // Uses PORT+1 (default 3002) so it doesn't conflict with the HTTPS server on PORT
    if (localHttpServer) {
      const LOCAL_PORT = parseInt(process.env.LAN_PORT ?? String(PORT + 1))
      localHttpServer.on("error", (err: NodeJS.ErrnoException) => {
        console.error(`❌ LAN HTTP port ${LOCAL_PORT} error:`, err.message)
      })
      localHttpServer.listen(LOCAL_PORT, "0.0.0.0", () => {
        console.log(`📱 LAN HTTP on http://0.0.0.0:${LOCAL_PORT} (lokalt netværk, ingen SSL)`)
      })
    }

    // 🎛️ Stream Deck – start connection attempt (non-blocking)
    streamDeckManager.setCallbacks(
      (clientId, val) => { io.emit('client:talk', { clientId, isTalking: val }) },
      (memberIds, val) => { io.emit('streamdeck:group:talk', { memberIds, val }) },
      io
    )
    streamDeckManager.connect().catch(() => {})
    console.log('🎛️ Stream Deck manager started')

  } catch (err) {

    console.error("❌ Failed to start server:", err)
    process.exit(1)

  }

}

/* ---------- SHUTDOWN ---------- */

process.on("SIGINT", () => {
  console.log("🛑 Shutting down...")
  process.exit()
})

process.on("SIGTERM", () => {
  console.log("🛑 Terminated")
  process.exit()
})

/* ---------- INIT ---------- */

start()
