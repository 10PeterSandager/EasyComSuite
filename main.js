'use strict'

// Ignore broken-pipe errors when the terminal that launched us closes its stdio
process.on('uncaughtException', (err) => { if (err.code !== 'EPIPE') throw err })

const { app, BrowserWindow, shell, ipcMain, globalShortcut, session } = require('electron')
const { spawn } = require('child_process')
const path = require('path')
const https = require('https')

// Disable Chrome autoplay policy — AudioContext works immediately, no user gesture needed
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')

// Accept self-signed localhost certs for all request types (page load, XHR, WebSocket)
app.on('certificate-error', (event, webContents, url, error, certificate, callback) => {
  if (url.includes('localhost') || url.includes('127.0.0.1')) {
    event.preventDefault()
    callback(true)
  } else {
    callback(false)
  }
})

const SERVER_ROOT = path.join(__dirname, '../server')
const SERVER_SCRIPT = path.join(SERVER_ROOT, 'dist', 'server.js')

// Read PORT from .env so it matches what the server actually binds to
function readEnvPort() {
  try {
    const env = require('fs').readFileSync(path.join(SERVER_ROOT, '.env'), 'utf8')
    const m = env.match(/^PORT=(\d+)/m)
    if (m) return m[1]
  } catch {}
  return '3000'
}
const PORT = process.env.PORT || readEnvPort()
const HOST_URL = `https://localhost:${PORT}/host`

let mainWindow = null
let serverProcess = null

function findNode() {
  const fs = require('fs')
  const candidates = [
    process.env.NODE_BIN,
    '/opt/homebrew/bin/node',
    '/usr/local/bin/node',
    '/usr/bin/node',
  ].filter(Boolean)
  for (const p of candidates) {
    try { if (fs.existsSync(p)) return p } catch {}
  }
  return 'node'
}

function startServer() {
  return new Promise((resolve, reject) => {
    const nodeBin = findNode()
    const serverEnv = { ...process.env, ELECTRON: '1' }
    delete serverEnv.ELECTRON_RUN_AS_NODE
    serverProcess = spawn(nodeBin, [SERVER_SCRIPT], {
      cwd: SERVER_ROOT,
      env: serverEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    const timeout = setTimeout(() => reject(new Error('Server did not start within 30s')), 30000)

    serverProcess.stdout.on('data', (chunk) => {
      try { process.stdout.write(chunk) } catch (_) {}
      if (chunk.toString().includes('Server running on')) {
        clearTimeout(timeout)
        resolve()
      }
    })

    serverProcess.stderr.on('data', (chunk) => { try { process.stderr.write(chunk) } catch (_) {} })

    serverProcess.on('error', (err) => { clearTimeout(timeout); reject(err) })
    serverProcess.on('exit', (code) => {
      console.log(`[electron] Server exited: ${code}`)
      if (code === 0) {
        // Intentional restart (e.g. port change saved via UI)
        console.log('[electron] Clean exit — restarting server...')
        setTimeout(async () => {
          try {
            await startServer()
            const newPort = readEnvPort()
            const newUrl = `https://localhost:${newPort}/host`
            await waitForHttp(newUrl)
            if (mainWindow) mainWindow.loadURL(newUrl)
          } catch (err) {
            console.error('[electron] Restart failed:', err)
          }
        }, 1000)
      }
    })
  })
}

function waitForHttp(url, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs
    const attempt = () => {
      if (Date.now() > deadline) return reject(new Error('Timed out waiting for server HTTPS'))
      const req = https.get(url, { rejectUnauthorized: false }, (res) => { res.resume(); resolve() })
      req.setTimeout(1000, () => req.destroy())
      req.on('error', () => setTimeout(attempt, 400))
    }
    attempt()
  })
}

function createLoadingWindow() {
  const win = new BrowserWindow({
    width: 360, height: 180,
    frame: false, resizable: false, center: true,
    backgroundColor: '#111111',
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  })
  win.loadURL(
    'data:text/html,<!DOCTYPE html><html><body style="margin:0;background:#111;color:#eee;' +
    'font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;' +
    'height:100vh;flex-direction:column;gap:14px">' +
    '<div style="font-size:36px">&#x26A1;</div>' +
    '<div style="font-size:15px;font-weight:600">EasyCom starter op…</div>' +
    '<div style="font-size:11px;color:#666">Venter på server...</div>' +
    '</body></html>'
  )
  return win
}

async function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1440, height: 960,
    minWidth: 900, minHeight: 600,
    title: 'EasyCom',
    backgroundColor: '#111111',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  })

  // Open external links (e.g. Cloudflare tunnel URLs) in default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  mainWindow.loadURL(HOST_URL)
  mainWindow.on('closed', () => { mainWindow = null; globalShortcut.unregisterAll() })

  globalShortcut.register('CommandOrControl+R', () => {
    if (mainWindow) mainWindow.webContents.reload()
  })

  // Expose IPC so host UI can open the QR setup window
  ipcMain.removeAllListeners('open-qr')
  ipcMain.on('open-qr', () => openQrWindow())
}

let qrWindow = null
function openQrWindow() {
  if (qrWindow && !qrWindow.isDestroyed()) { qrWindow.focus(); return }
  qrWindow = new BrowserWindow({
    width: 520, height: 700,
    title: 'EasyCom — Opsæt telefon',
    backgroundColor: '#111111',
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  })
  qrWindow.setMenuBarVisibility(false)
  qrWindow.loadURL(`https://localhost:${PORT}/qr`)
  qrWindow.on('closed', () => { qrWindow = null })
}

app.whenReady().then(async () => {
  // Clear cached JS/HTML so updated builds load immediately
  await session.defaultSession.clearCache()

  const loading = createLoadingWindow()

  try {
    // If a launchd service already started the server, skip our own start
    let alreadyRunning = false
    try { await waitForHttp(HOST_URL, 2000); alreadyRunning = true } catch {}

    if (!alreadyRunning) await startServer()
    await waitForHttp(HOST_URL)

    loading.close()
    await createMainWindow()
  } catch (err) {
    console.error('[electron] Startup failed:', err)
    loading.close()
    app.quit()
  }
})

app.on('window-all-closed', () => {
  if (serverProcess) { serverProcess.kill('SIGTERM'); serverProcess = null }
  app.quit()
})

app.on('activate', () => {
  if (!mainWindow) createMainWindow().catch(console.error)
})
