'use strict'

const { app, BrowserWindow, shell } = require('electron')
const { spawn } = require('child_process')
const path = require('path')
const http = require('http')

// Disable Chrome autoplay policy — AudioContext works immediately, no user gesture needed
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')

const SERVER_ROOT = path.join(__dirname, '..')
const SERVER_SCRIPT = path.join(SERVER_ROOT, 'dist', 'server.js')
const PORT = process.env.PORT || '3000'
const HOST_URL = `http://localhost:${PORT}/host`

let mainWindow = null
let serverProcess = null

function startServer() {
  return new Promise((resolve, reject) => {
    serverProcess = spawn(process.execPath, [SERVER_SCRIPT], {
      cwd: SERVER_ROOT,
      env: { ...process.env, ELECTRON: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    const timeout = setTimeout(() => reject(new Error('Server did not start within 30s')), 30000)

    serverProcess.stdout.on('data', (chunk) => {
      process.stdout.write(chunk)
      if (chunk.toString().includes('Server running on')) {
        clearTimeout(timeout)
        resolve()
      }
    })

    serverProcess.stderr.on('data', (chunk) => process.stderr.write(chunk))

    serverProcess.on('error', (err) => { clearTimeout(timeout); reject(err) })
    serverProcess.on('exit', (code) => console.log(`[electron] Server exited: ${code}`))
  })
}

function waitForHttp(url, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs
    const attempt = () => {
      if (Date.now() > deadline) return reject(new Error('Timed out waiting for server HTTP'))
      const req = http.get(url, (res) => { res.resume(); resolve() })
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
    '<div style="font-size:36px">⚡</div>' +
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

  // Open external links (e.g. Cloudflare tunnel URLs) in default browser, not in Electron
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  mainWindow.loadURL(HOST_URL)
  mainWindow.on('closed', () => { mainWindow = null })
}

app.whenReady().then(async () => {
  const loading = createLoadingWindow()

  try {
    await startServer()
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
