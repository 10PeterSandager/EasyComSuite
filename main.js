const { app, BrowserWindow, systemPreferences, session } = require('electron');

// 🔥 Auto-launch at system login (survives power loss)
app.setLoginItemSettings({
  openAtLogin: true,
  openAsHidden: false,
  name: 'EasyCom Mobile'
})

// WebRTC video decode fixes – INGEN disable-gpu (ødelægger VP8 decoder)
app.commandLine.appendSwitch('enable-features', 'WebRTCPipeWireCapturer,MediaStreamTrackProcessorForVideoCapture')
app.commandLine.appendSwitch('disable-features', 'HardwareMediaKeyHandling,MediaSessionService')
// Allow navigator.mediaDevices (getUserMedia / enumerateDevices) from localhost renderer
app.commandLine.appendSwitch('unsafely-treat-insecure-origin-as-secure', 'http://localhost:3006')
app.commandLine.appendSwitch('allow-insecure-localhost')

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 768,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      backgroundThrottling: false,
      webSecurity: false,
      allowRunningInsecureContent: true,
      zoomFactor: 2.0,
    },
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0f1115',
    show: false
  });

  win.loadURL('http://localhost:3006');
  win.once('ready-to-show', () => {
    win.webContents.setZoomFactor(2.0);
    win.show();
    win.webContents.openDevTools({ mode: 'detach' });
  });

  if (process.platform === 'darwin') {
    Promise.all([
      systemPreferences.askForMediaAccess('microphone'),
      systemPreferences.askForMediaAccess('camera'),
    ]).then(([mic, cam]) => {
      console.log('[Electron] Media access - mic:', mic, 'cam:', cam);
    });
  }
}

app.whenReady().then(() => {
  console.log('[Electron] Versions:', JSON.stringify(process.versions, null, 2))

  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(true);
  });
  session.defaultSession.setPermissionCheckHandler((webContents, permission) => {
    return true;
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
