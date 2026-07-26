#!/usr/bin/env python3
"""
EasyCom Server — macOS GUI Installer
Pure Python stdlib. No external deps.
Launched by .command which handles sudo auth before opening browser.
"""

import os, sys, re, threading, time, webbrowser, socket, json, subprocess, signal, queue
from http.server import HTTPServer, BaseHTTPRequestHandler

SCRIPT_DIR     = os.path.dirname(os.path.abspath(__file__))
INSTALL_SCRIPT = os.path.join(SCRIPT_DIR, "install-mac.sh")

def read_env():
    """Return .env as a dict."""
    env = {}
    try:
        with open(os.path.join(SCRIPT_DIR, ".env")) as f:
            for line in f:
                line = line.strip()
                if "=" in line and not line.startswith("#"):
                    k, v = line.split("=", 1)
                    env[k.strip()] = v.strip()
    except Exception:
        pass
    return env

def get_host_url():
    """Return the correct host UI URL based on .env configuration."""
    env = read_env()
    ssl_cert = env.get("SSL_CERT_PATH", "")
    domain = env.get("HOST_DOMAIN", "")
    if ssl_cert and domain:
        return f"https://{domain}:3000/host"
    return f"{'https' if ssl_cert else 'http'}://localhost:3000/host"

def ensure_hosts_entry(domain):
    """Add 127.0.0.1 <domain> to /etc/hosts if not already present (requires sudo)."""
    try:
        with open("/etc/hosts") as f:
            if domain in f.read():
                return
        with open("/etc/hosts", "a") as f:
            f.write(f"\n127.0.0.1 {domain}\n")
        subprocess.run(["dscacheutil", "-flushcache"], capture_output=True)
        subprocess.run(["killall", "-HUP", "mDNSResponder"], capture_output=True)
    except Exception:
        pass

STEPS = [
    (0, "Homebrew",              ["Homebrew"]),
    (1, "Node.js",               ["Node.js"]),
    (2, "ffmpeg",                ["ffmpeg"]),
    (3, "LAN IP",                ["Local IP", "IP:"]),
    (4, "Configuration",         [".env"]),
    (5, "npm install",           ["npm install", "Dependencies", "afhæng"]),
    (6, "Build server",          ["Building server", "Server built", "tsc"]),
    (7, "Build Host UI",         ["broadcast-intercom", "Host-UI", "Host app"]),
    (8, "System service",        ["launchd", "launchctl", "service", "Auto-start"]),
    (9, "Desktop icon",          ["skrivebordsikon", "Desktop icon", "EasyCom Host.app"]),
]

def strip_ansi(s):
    return re.sub(r'\x1b\[[0-9;]*[mGKHF]|\x1b\(B|\x1b=|\r', '', s)

def line_cls(line):
    if '✅' in line or '[OK]'  in line: return 'ok'
    if '⚠️'  in line or '[!!]' in line: return 'warn'
    if '❌'  in line or '[XX]' in line or 'error:' in line.lower(): return 'err'
    if line.strip().startswith('━'): return 'dim'
    return ''

def sse(d: dict) -> bytes:
    return ("data: " + json.dumps(d, ensure_ascii=False) + "\n\n").encode()

SSE_PING = b": ping\n\n"

# ── Desktop App Creator ────────────────────────────────────────────────────────
def create_desktop_app(send):
    """Create EasyCom Host.app on the user's Desktop. Runs as user — no sudo needed."""
    import math, zlib, struct, shutil

    send(sse({"type": "log", "text": "Creating desktop icon…", "cls": "dim"}))

    desktop  = os.path.join(os.path.expanduser("~"), "Desktop")
    app_path = os.path.join(desktop, "EasyCom Host.app")
    iconset  = "/tmp/easycom_host_gui.iconset"

    def make_png(w, h, pixels):
        def chunk(tag, data):
            crc = zlib.crc32(tag + data) & 0xffffffff
            return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", crc)
        sig  = b'\x89PNG\r\n\x1a\n'
        ihdr = chunk(b'IHDR', struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0))
        raw  = bytearray()
        for row in range(h):
            raw.append(0)
            for col in range(w):
                raw.extend(pixels[row * w + col])
        return sig + ihdr + chunk(b'IDAT', zlib.compress(bytes(raw), 9)) + chunk(b'IEND', b'')

    FONT = {
        'E': ["########","#       ","#       ","######  ","#       ","#       ","#       ","########"],
        'A': ["   ##   "," #    # ","#      #","#      #","########","#      #","#      #","#      #"],
        'S': [" ###### ","#      #","#       "," #####  ","      # ","#      #","#      #"," ###### "],
        'Y': ["#      #"," #    # ","  #  #  ","   ##   ","   ##   ","   ##   ","   ##   ","   ##   "],
        'C': [" ###### ","#      #","#       ","#       ","#       ","#       ","#      #"," ###### "],
        'O': [" ###### ","#      #","#      #","#      #","#      #","#      #","#      #"," ###### "],
        'M': ["#      #","##    ##","# #  # #","#  ##  #","#      #","#      #","#      #","#      #"],
    }

    def draw_icon(size):
        dark   = (28, 28, 30, 255)
        white  = (255, 255, 255, 255)
        orange = (248, 115, 22, 255)
        pixels = [dark] * (size * size)

        def px(x, y, color):
            if 0 <= x < size and 0 <= y < size:
                pixels[y * size + x] = color

        cr = int(size * 0.17)
        for y in range(size):
            for x in range(size):
                dx = max(cr - x, 0, x - (size - 1 - cr))
                dy = max(cr - y, 0, y - (size - 1 - cr))
                if dx*dx + dy*dy > cr*cr:
                    pixels[y * size + x] = (0, 0, 0, 0)

        bar_h = max(int(size * 0.085), 4)
        for y in range(size - bar_h, size):
            for x in range(size):
                if pixels[y * size + x][3] == 255:
                    px(x, y, orange)

        word  = "EASYCOM"
        scale = max(size // 72, 1)
        cw    = (8 + 1) * scale
        total = cw * len(word) - scale
        sx0   = (size - total) // 2
        sy0   = max(int(size * 0.10), cr - int(math.sqrt(max(cr*cr - (cr-sx0)**2, 0))) + 4)

        for ci, ch in enumerate(word):
            color = orange if ch == 'O' else white
            bx    = sx0 + ci * cw
            for ri, row_bits in enumerate(FONT.get(ch, FONT['E'])):
                for col_i, bit in enumerate(row_bits):
                    if bit == '#':
                        for sy in range(scale):
                            for scx in range(scale):
                                px(bx + col_i*scale + scx, sy0 + ri*scale + sy, color)

        lscale   = max(size // 18, 1)
        L        = 8 * lscale
        lx0      = (size - L) // 2
        text_bot = sy0 + 8 * scale
        bar_top  = size - bar_h
        ly0      = text_bot + (bar_top - text_bot - L) // 2
        t        = max(int(L * 0.13), 2)
        for y in range(L):
            for x in range(t): px(lx0+x, ly0+y, orange)
            for x in range(t): px(lx0+L-t+x, ly0+y, orange)
        mid = (L - t) // 2
        for y in range(t):
            for x in range(L): px(lx0+x, ly0+mid+y, orange)
        return pixels

    try:
        shutil.rmtree(iconset, ignore_errors=True)
        os.makedirs(iconset, exist_ok=True)
        for s in [16, 32, 64, 128, 256, 512, 1024]:
            with open(f"{iconset}/icon_{s}x{s}.png", 'wb') as f:
                f.write(make_png(s, s, draw_icon(s)))
        for src, dst in [("32","16x16@2x"),("64","32x32@2x"),("256","128x128@2x"),
                         ("512","256x256@2x"),("1024","512x512@2x")]:
            shutil.copy(f"{iconset}/icon_{src}x{src}.png", f"{iconset}/icon_{dst}.png")
        icns = "/tmp/easycom_host_gui.icns"
        icns_ok = subprocess.run(["iconutil", "-c", "icns", iconset, "-o", icns],
                                 capture_output=True).returncode == 0
    except Exception:
        icns_ok = False

    try:
        shutil.rmtree(app_path, ignore_errors=True)
        os.makedirs(f"{app_path}/Contents/MacOS", exist_ok=True)
        os.makedirs(f"{app_path}/Contents/Resources", exist_ok=True)

        host_url = get_host_url()
        env = read_env()
        domain = env.get("HOST_DOMAIN", "")
        if domain:
            ensure_hosts_entry(domain)

        launcher = f"{app_path}/Contents/MacOS/EasyCom Host"
        with open(launcher, "w") as f:
            f.write(f'#!/bin/bash\nopen "{host_url}"\n')
        os.chmod(launcher, 0o755)

        with open(f"{app_path}/Contents/Info.plist", "w") as f:
            f.write(
                '<?xml version="1.0" encoding="UTF-8"?>\n'
                '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"'
                ' "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n'
                '<plist version="1.0"><dict>\n'
                '  <key>CFBundleExecutable</key>     <string>EasyCom Host</string>\n'
                '  <key>CFBundleIdentifier</key>     <string>dk.easycom.host</string>\n'
                '  <key>CFBundleName</key>           <string>EasyCom Host</string>\n'
                '  <key>CFBundleVersion</key>        <string>1.0</string>\n'
                '  <key>CFBundlePackageType</key>    <string>APPL</string>\n'
                '  <key>CFBundleIconFile</key>       <string>AppIcon</string>\n'
                '  <key>LSUIElement</key>            <false/>\n'
                '  <key>LSMinimumSystemVersion</key> <string>12.0</string>\n'
                '</dict></plist>\n'
            )

        if icns_ok:
            shutil.copy(icns, f"{app_path}/Contents/Resources/AppIcon.icns")

        subprocess.run(["xattr", "-cr", app_path], capture_output=True)

        send(sse({"type": "log", "text": "✅ Desktop icon created: EasyCom Host.app", "cls": "ok"}))
    except Exception as e:
        send(sse({"type": "log", "text": f"⚠️  Desktop icon failed: {e}", "cls": "warn"}))


# ── Installer ─────────────────────────────────────────────────────────────────
def run_install(send):
    """Run install-mac.sh via sudo -n (Terminal already cached credentials)."""
    send(sse({"type": "log", "text": "Starting installation…", "cls": "dim"}))

    try:
        proc = subprocess.Popen(
            ["sudo", "-n", "bash", INSTALL_SCRIPT],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True, bufsize=1
        )
    except Exception as e:
        send(sse({"type": "log", "text": f"Could not start: {e}", "cls": "err"}))
        send(sse({"type": "error"}))
        return

    # Check immediately if sudo -n failed (no cached credentials)
    # Give it 0.5s to start writing output
    q: queue.Queue[str | None] = queue.Queue()

    def reader():
        try:
            for line in iter(proc.stdout.readline, ''):
                q.put(line)
        finally:
            q.put(None)

    threading.Thread(target=reader, daemon=True).start()

    step_state   = ["pending"] * len(STEPS)
    current_step = -1
    total        = len(STEPS)
    first_line   = True
    idle         = 0

    while True:
        try:
            item = q.get(timeout=0.4)
        except queue.Empty:
            try: send(SSE_PING)
            except: break
            idle += 1
            if idle == 5 and first_line:
                # Still no output after 2s — sudo -n probably failed
                proc.poll()
                if proc.returncode is not None and proc.returncode != 0:
                    send(sse({"type": "log",
                              "text": "No administrator rights. Restart the installer and enter your password in the Terminal window.",
                              "cls": "err"}))
                    send(sse({"type": "error"}))
                    return
            continue

        if item is None:
            break

        first_line = False
        idle = 0
        line = strip_ansi(item).rstrip()
        if not line:
            continue

        cls = line_cls(line)
        send(sse({"type": "log", "text": line, "cls": cls}))

        for idx, label, keywords in STEPS:
            if any(kw.lower() in line.lower() for kw in keywords):
                if step_state[idx] == "pending":
                    if current_step >= 0 and step_state[current_step] == "running":
                        step_state[current_step] = "done"
                        send(sse({"type": "step", "i": current_step, "state": "done",
                                  "label": STEPS[current_step][1]}))
                        done_n = sum(1 for s in step_state if s == "done")
                        send(sse({"type": "progress", "pct": int(done_n / total * 92)}))
                    step_state[idx] = "running"
                    current_step    = idx
                    send(sse({"type": "step", "i": idx, "state": "running", "label": label}))
                break

        if ('✅' in line or '[OK]' in line) and current_step >= 0:
            if step_state[current_step] == "running":
                step_state[current_step] = "done"
                send(sse({"type": "step", "i": current_step, "state": "done",
                          "label": STEPS[current_step][1]}))
                done_n = sum(1 for s in step_state if s == "done")
                send(sse({"type": "progress", "pct": int(done_n / total * 92)}))

        if '❌' in line and current_step >= 0 and step_state[current_step] == "running":
            step_state[current_step] = "failed"
            send(sse({"type": "step", "i": current_step, "state": "failed",
                      "label": STEPS[current_step][1]}))

    proc.wait()
    for idx in range(len(STEPS)):
        if step_state[idx] == "running":
            step_state[idx] = "done"
            send(sse({"type": "step", "i": idx, "state": "done", "label": STEPS[idx][1]}))

    # Create Desktop .app directly as the user (no sudo needed, more reliable than root)
    create_desktop_app(send)

    send(sse({"type": "progress", "pct": 100}))
    send(sse({"type": "done"}))

# ── HTML ──────────────────────────────────────────────────────────────────────
HTML = r"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>EasyCom Host Installer</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#1c1c1e;--card:#2c2c2e;--border:#3a3a3c;
  --orange:#f87316;--og:rgba(248,115,22,.16);
  --green:#22c55e;--gg:rgba(34,197,94,.12);
  --red:#ef4444;--rg:rgba(239,68,68,.12);
  --text:#e5e7eb;--dim:#6b7280;
}
html,body{height:100%;background:var(--bg);color:var(--text);
  font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text',sans-serif;overflow:hidden}

.header{
  background:#000;padding:20px 36px 16px;
  display:flex;align-items:center;gap:16px;
  border-bottom:1px solid #111;flex-shrink:0;
}
.logo-icon{
  width:52px;height:52px;background:#1c1c1e;border-radius:12px;
  display:flex;align-items:center;justify-content:center;
  position:relative;overflow:hidden;flex-shrink:0;
}
.logo-icon::after{content:'';position:absolute;bottom:0;left:0;right:0;
  height:7px;background:var(--orange);}
.brand{font-size:22px;font-weight:900;letter-spacing:4px;color:#fff;line-height:1}
.brand .o{color:var(--orange)}
.sub{font-size:10px;letter-spacing:2px;color:var(--dim);text-transform:uppercase;margin-top:4px}
.hdr-r{margin-left:auto;font-size:11px;color:var(--dim)}

.layout{display:grid;grid-template-columns:240px 1fr;height:calc(100vh - 89px)}

.sidebar{border-right:1px solid var(--border);padding:20px 14px;
  background:#1a1a1c;overflow-y:auto;}
.stitle{font-size:10px;font-weight:700;letter-spacing:1.5px;color:var(--dim);
  text-transform:uppercase;margin-bottom:12px;padding-left:4px}
.step{display:flex;align-items:center;gap:10px;padding:8px 10px;
  border-radius:8px;margin-bottom:2px;transition:background .15s}
.step.running{background:var(--og)}.step.done{background:var(--gg)}.step.failed{background:var(--rg)}
.snum{width:22px;height:22px;border-radius:50%;display:flex;align-items:center;
  justify-content:center;font-size:11px;font-weight:700;flex-shrink:0;transition:all .2s}
.step.pending .snum{background:var(--border);color:var(--dim)}
.step.running .snum{background:var(--orange);color:#fff;animation:pulse 1.2s ease-in-out infinite}
.step.done    .snum{background:var(--green);color:#fff}
.step.failed  .snum{background:var(--red);color:#fff}
.slabel{font-size:12px;transition:color .15s}
.step.pending .slabel{color:var(--dim)}
.step.running .slabel{color:var(--orange);font-weight:600}
.step.done    .slabel{color:var(--text)}
.step.failed  .slabel{color:var(--red)}

.right{display:flex;flex-direction:column;padding:20px 24px;gap:14px;overflow:hidden}

.terminal{flex:1;background:#0a0a0a;border-radius:10px;
  border:1px solid var(--border);overflow:hidden;
  display:flex;flex-direction:column;min-height:0}
.tbar{padding:7px 12px;background:#111;border-bottom:1px solid var(--border);
  display:flex;align-items:center;gap:6px;flex-shrink:0}
.dot{width:11px;height:11px;border-radius:50%}
.dr{background:#ff5f57}.dy{background:#febc2e}.dg{background:#28c840}
.tlbl{margin-left:4px;font-size:11px;color:var(--dim)}
#log{flex:1;overflow-y:auto;padding:12px 14px;
  font-family:'SF Mono',Menlo,monospace;font-size:12px;
  color:#c9d1d9;white-space:pre-wrap;word-break:break-all;line-height:1.6}
.ok{color:#22c55e}.warn{color:#f97316}.err{color:#ef4444}.dim{color:#484f58}

.pgtrack{height:4px;background:var(--border);border-radius:2px;overflow:hidden;flex-shrink:0}
.pgfill{height:100%;background:var(--orange);border-radius:2px;transition:width .4s ease}

.bottom{display:flex;align-items:center;gap:14px;flex-shrink:0}
.btn{background:var(--orange);color:#fff;border:none;padding:12px 28px;
  border-radius:9px;font-size:14px;font-weight:700;cursor:pointer;transition:background .15s}
.btn:hover:not(:disabled){background:#ea6b0a}
.btn:disabled{opacity:.4;cursor:default}
.btn-o{background:transparent;border:1.5px solid var(--border);color:var(--text)}
.btn-o:hover:not(:disabled){background:var(--border)}
.stxt{font-size:13px;color:var(--dim)}

.done-card{display:none;background:var(--card);border:1px solid var(--border);
  border-radius:12px;padding:22px;flex-direction:column;
  align-items:center;text-align:center;gap:10px;flex-shrink:0}
.done-icon{font-size:40px;line-height:1}
.done-h{font-size:18px;font-weight:700}
.done-sub{color:var(--dim);font-size:13px;line-height:1.5}
.done-url{color:var(--orange);font-family:'SF Mono',Menlo,monospace;
  font-size:12px;background:#000;padding:5px 12px;border-radius:5px}
.done-btns{display:flex;gap:10px;margin-top:4px}

@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
</style>
</head>
<body>
<div class="header">
  <div class="logo-icon">
    <svg width="30" height="30" viewBox="0 0 8 8" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges">
      <rect x="0" y="0" width="1" height="7" fill="#f87316"/>
      <rect x="7" y="0" width="1" height="7" fill="#f87316"/>
      <rect x="0" y="3" width="8" height="1" fill="#f87316"/>
    </svg>
  </div>
  <div>
    <div class="brand">EASYC<span class="o">O</span>M</div>
    <div class="sub">Host Installer</div>
  </div>
  <div class="hdr-r">macOS · v1.0</div>
</div>

<div class="layout">
  <div class="sidebar">
    <div class="stitle">Installation steps</div>
    <div class="step pending" id="s0"><div class="snum">1</div><div class="slabel">Homebrew</div></div>
    <div class="step pending" id="s1"><div class="snum">2</div><div class="slabel">Node.js</div></div>
    <div class="step pending" id="s2"><div class="snum">3</div><div class="slabel">ffmpeg</div></div>
    <div class="step pending" id="s3"><div class="snum">4</div><div class="slabel">LAN IP</div></div>
    <div class="step pending" id="s4"><div class="snum">5</div><div class="slabel">Configuration</div></div>
    <div class="step pending" id="s5"><div class="snum">6</div><div class="slabel">npm install</div></div>
    <div class="step pending" id="s6"><div class="snum">7</div><div class="slabel">Build server</div></div>
    <div class="step pending" id="s7"><div class="snum">8</div><div class="slabel">Build Host UI</div></div>
    <div class="step pending" id="s8"><div class="snum">9</div><div class="slabel">System service</div></div>
    <div class="step pending" id="s9"><div class="snum">10</div><div class="slabel">Desktop icon</div></div>
  </div>

  <div class="right">
    <div class="done-card" id="done">
      <div class="done-icon">✅</div>
      <div class="done-h">EasyCom Host installed!</div>
      <div class="done-sub">The server runs and starts automatically on boot.</div>
      <div class="done-url" id="hosturl">localhost:3000/host</div>
      <div class="done-btns">
        <button class="btn" onclick="openHost()">Open Host UI</button>
        <button class="btn btn-o" onclick="window.close()">Close</button>
      </div>
    </div>

    <div class="terminal">
      <div class="tbar">
        <span class="dot dr"></span><span class="dot dy"></span><span class="dot dg"></span>
        <span class="tlbl">Installation log</span>
      </div>
      <div id="log"><span class="dim">Click "Install" to begin…</span></div>
    </div>

    <div class="pgtrack"><div class="pgfill" id="pg" style="width:0%"></div></div>

    <div class="bottom" id="bot">
      <button class="btn" id="btn" onclick="go()">Install</button>
      <span class="stxt" id="stxt">Requires administrator access</span>
    </div>
  </div>
</div>

<script>
const logEl  = document.getElementById('log')
const pgEl   = document.getElementById('pg')
const btnEl  = document.getElementById('btn')
const stxtEl = document.getElementById('stxt')

function addLog(text, cls) {
  if (logEl.children.length === 1 && logEl.children[0].classList.contains('dim'))
    logEl.innerHTML = ''
  const sp = document.createElement('span')
  if (cls) sp.className = cls
  sp.textContent = text + '\n'
  logEl.appendChild(sp)
  logEl.scrollTop = logEl.scrollHeight
}
function setStep(i, state) {
  const el = document.getElementById('s' + i)
  if (el) el.className = 'step ' + state
}
function go() {
  btnEl.disabled = true
  stxtEl.textContent = 'Installing…'
  const es = new EventSource('/install')
  es.onmessage = e => {
    const d = JSON.parse(e.data)
    if (d.type === 'log')      addLog(d.text, d.cls)
    if (d.type === 'step')   { setStep(d.i, d.state); if(d.state==='running') stxtEl.textContent = d.label }
    if (d.type === 'progress') pgEl.style.width = d.pct + '%'
    if (d.type === 'done')   { es.close(); showDone() }
    if (d.type === 'error')  {
      es.close()
      stxtEl.textContent = 'Error — see log'
      btnEl.disabled = false
      btnEl.textContent = 'Try again'
    }
  }
  es.onerror = () => { stxtEl.textContent = 'Connection error'; btnEl.disabled = false }
}
function showDone() {
  pgEl.style.width = '100%'
  document.getElementById('done').style.display = 'flex'
  document.getElementById('bot').style.display = 'none'
}
fetch('/host-url').then(r=>r.text()).then(u=>{ document.getElementById('hosturl').textContent=u })
function openHost() { fetch('/open') }
</script>
</body>
</html>
"""

# ── HTTP handler ──────────────────────────────────────────────────────────────
class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_): pass
    def do_GET(self):
        if self.path == "/":
            body = HTML.encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", len(body))
            self.end_headers()
            self.wfile.write(body)
        elif self.path == "/install":
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("X-Accel-Buffering", "no")
            self.end_headers()
            def send(data):
                try: self.wfile.write(data); self.wfile.flush()
                except: pass
            run_install(send)
        elif self.path == "/host-url":
            body = get_host_url().encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/plain")
            self.send_header("Content-Length", len(body))
            self.end_headers()
            self.wfile.write(body)
        elif self.path == "/open":
            subprocess.Popen(["open", get_host_url()])
            self.send_response(200); self.end_headers()
        else:
            self.send_response(404); self.end_headers()

# ── Main ──────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    if not os.path.exists(INSTALL_SCRIPT):
        print(f"Fejl: install-mac.sh ikke fundet: {INSTALL_SCRIPT}", file=sys.stderr)
        sys.exit(1)

    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]

    srv = HTTPServer(("127.0.0.1", port), Handler)
    url = f"http://127.0.0.1:{port}"
    print(f"EasyCom GUI Installer → {url}")

    threading.Thread(target=lambda: (time.sleep(0.7), webbrowser.open(url)), daemon=True).start()
    signal.signal(signal.SIGINT, lambda *_: (srv.shutdown(), sys.exit(0)))
    try: srv.serve_forever()
    except KeyboardInterrupt: pass
