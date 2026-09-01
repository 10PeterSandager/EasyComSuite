import React, { useState, useEffect } from 'react'
import { NetworkConfig, RemoteHost, HardwareInterface } from '../types'
import { Globe, RefreshCw, Users, Wifi, Shield, CheckCircle, Loader, RotateCw, AlertTriangle, Link } from 'lucide-react'
import { socket } from '../client/webrtc/intercom'

interface NetworkPanelProps {
  network: NetworkConfig
  setNetwork: (n: NetworkConfig) => void
  remoteHosts: RemoteHost[]
  hardware: HardwareInterface[]
  refreshHardware: () => Promise<void>
  forceResumeAudio: () => Promise<void>
  globalInputLevel: number
}

const LS_NET     = 'easycom_local_network'
const LS_INET    = 'easycom_internet_config'

function loadInetCache() {
  try { return JSON.parse(localStorage.getItem(LS_INET) ?? '{}') } catch { return {} }
}

const NetworkPanel: React.FC<NetworkPanelProps> = ({ network, setNetwork, remoteHosts }) => {
  const [scanning, setScanning] = useState(false)

  // ── Internet / WebRTC config — seeded from localStorage immediately ────────
  const cache = loadInetCache()
  const [announcedIp, setAnnouncedIp]         = useState(cache.announcedIp     ?? '')
  const [turnUrl, setTurnUrl]                 = useState(cache.turnUrl          ?? '')
  const [turnUsername, setTurnUsername]       = useState(cache.turnUsername     ?? '')
  const [turnPassword, setTurnPassword]       = useState(cache.turnPassword     ?? '')
  const [sessionPassword, setSessionPassword] = useState(cache.sessionPassword  ?? '')
  const [cfTunnelUrl, setCfTunnelUrl]         = useState(cache.cfTunnelUrl      ?? '')
  const [cfTunnelToken, setCfTunnelToken]     = useState(cache.cfTunnelToken    ?? '')
  const [port, setPort]                       = useState(cache.port ?? 3000)
  const [lanPort, setLanPort]                 = useState(cache.lanPort ?? 3001)
  const [detecting, setDetecting]             = useState(false)
  const [saving, setSaving]                   = useState(false)
  const [saveStatus, setSaveStatus]           = useState<'idle' | 'ok' | 'error'>('idle')
  const [restarting, setRestarting]           = useState(false)
  const [restartNeeded, setRestartNeeded]     = useState(false)

  // Also sync from server (authoritative) once socket is ready
  useEffect(() => {
    const load = () => {
      socket.emit('server:config:get', (cfg: any) => {
        if (!cfg) return
        setAnnouncedIp(cfg.announcedIp ?? '')
        setTurnUrl(cfg.turnUrl ?? '')
        setTurnUsername(cfg.turnUsername ?? '')
        setTurnPassword(cfg.turnPassword ?? '')
        setSessionPassword(cfg.sessionPassword ?? '')
        if (cfg.cfTunnelUrl)   setCfTunnelUrl(cfg.cfTunnelUrl)
        if (cfg.cfTunnelToken) setCfTunnelToken(cfg.cfTunnelToken)
        if (cfg.port)    setPort(cfg.port)
        if (cfg.lanPort) setLanPort(cfg.lanPort)
      })
    }
    if (socket.connected) load()
    else socket.once('connect', load)
  }, [])

  const autoDetectIp = async () => {
    setDetecting(true)
    try {
      const r = await fetch('https://api.ipify.org?format=json')
      const { ip } = await r.json()
      setAnnouncedIp(ip)
    } catch {
      // silently fail — user can type it manually
    } finally {
      setDetecting(false)
    }
  }

  const saveConfig = () => {
    setSaving(true)
    setSaveStatus('idle')

    // Timeout fallback — if the server doesn't respond in 5s, show error
    const timeout = setTimeout(() => {
      setSaving(false)
      setSaveStatus('error')
      setTimeout(() => setSaveStatus('idle'), 3000)
    }, 5000)

    const cfg = {
      announcedIp:     announcedIp.trim(),
      turnUrl:         turnUrl.trim(),
      turnUsername:    turnUsername.trim(),
      turnPassword:    turnPassword.trim(),
      sessionPassword: sessionPassword.trim(),
      cfTunnelUrl:     cfTunnelUrl.trim(),
      cfTunnelToken:   cfTunnelToken.trim(),
      port,
      lanPort,
    }
    try {
      localStorage.setItem(LS_INET, JSON.stringify(cfg))
      localStorage.setItem('easycom_host_session_pw', cfg.sessionPassword)
    } catch {}

    socket.emit('server:config:update', cfg, (res: any) => {
      clearTimeout(timeout)
      setSaving(false)
      setSaveStatus(res?.ok ? 'ok' : 'error')
      if (res?.ok) setRestartNeeded(true)
      setTimeout(() => setSaveStatus('idle'), 3000)
    })
  }

  const handleRestart = () => {
    setRestarting(true)
    socket.emit('server:restart', () => {
      // Server will exit and Electron will restart it — reload after delay
      setTimeout(() => window.location.reload(), 4000)
    })
  }

  const updateNet = (field: keyof NetworkConfig, value: any) => {
    const updated = { ...network, [field]: value }
    setNetwork(updated)
    try { localStorage.setItem(LS_NET, JSON.stringify(updated)) } catch {}
  }

  const refreshHosts = () => { setScanning(true); setTimeout(() => setScanning(false), 2000) }

  return (
    <div className="h-full overflow-auto p-6 space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* ── INTERNET ACCESS ─────────────────────────────────────────── */}
        <div className="bg-zinc-900 p-6 rounded-2xl border border-white/5 space-y-4">
          <div className="flex items-center gap-3">
            <Wifi size={16} className="text-orange-400" />
            <h3 className="text-sm font-bold text-white">Internet Access</h3>
          </div>

          <p className="text-[10px] text-white/30 leading-relaxed">
            Set your public IP or DuckDNS hostname so remote clients can connect over the internet.
          </p>

          {/* Public / Announced IP */}
          <div>
            <label className="text-[10px] text-white/40 uppercase tracking-wider">
              Public IP / Hostname
            </label>
            <div className="flex gap-2 mt-1">
              <input
                type="text"
                value={announcedIp}
                onChange={e => setAnnouncedIp(e.target.value)}
                placeholder="1.2.3.4 or easycomserver.duckdns.org"
                className="flex-1 px-3 py-2 bg-black border border-white/10 rounded text-xs text-white font-mono"
                spellCheck={false}
                autoCapitalize="none"
              />
              <button
                onClick={autoDetectIp}
                disabled={detecting}
                title="Auto-detect my public IP"
                className="px-3 py-2 bg-zinc-800 hover:bg-zinc-700 border border-white/10 rounded text-[10px] font-bold text-white/60 hover:text-white transition-colors disabled:opacity-50 flex items-center gap-1.5 whitespace-nowrap"
              >
                {detecting
                  ? <Loader size={11} className="animate-spin" />
                  : <Globe size={11} />}
                Auto-detect
              </button>
            </div>
            <p className="text-[9px] text-white/20 mt-1">
              Used by mediasoup so remote clients know where to send audio.
            </p>
          </div>

          {/* TURN server (optional) */}
          <div className="pt-2 border-t border-white/5 space-y-3">
            <div className="flex items-center gap-2">
              <Shield size={11} className="text-white/30" />
              <span className="text-[10px] text-white/40 uppercase tracking-wider">TURN Server (optional)</span>
            </div>
            <p className="text-[9px] text-white/20">
              Only needed when clients are behind strict firewalls that block UDP.
            </p>
            <div>
              <label className="text-[10px] text-white/30 uppercase tracking-wider">TURN URL</label>
              <input
                type="text"
                value={turnUrl}
                onChange={e => setTurnUrl(e.target.value)}
                placeholder="turn:your.turn-server.com:3478"
                className="w-full mt-1 px-3 py-2 bg-black border border-white/10 rounded text-xs text-white font-mono"
                spellCheck={false}
                autoCapitalize="none"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] text-white/30 uppercase tracking-wider">Username</label>
                <input
                  type="text"
                  value={turnUsername}
                  onChange={e => setTurnUsername(e.target.value)}
                  className="w-full mt-1 px-3 py-2 bg-black border border-white/10 rounded text-xs text-white"
                  autoCapitalize="none"
                />
              </div>
              <div>
                <label className="text-[10px] text-white/30 uppercase tracking-wider">Password</label>
                <input
                  type="password"
                  value={turnPassword}
                  onChange={e => setTurnPassword(e.target.value)}
                  className="w-full mt-1 px-3 py-2 bg-black border border-white/10 rounded text-xs text-white"
                />
              </div>
            </div>
          </div>

          {/* Session password */}
          <div className="pt-2 border-t border-white/5 space-y-2">
            <div className="flex items-center gap-2">
              <Shield size={11} className="text-orange-400" />
              <span className="text-[10px] text-white/40 uppercase tracking-wider">Session Password</span>
            </div>
            <input
              type="password"
              value={sessionPassword}
              onChange={e => setSessionPassword(e.target.value)}
              placeholder="Leave empty for no password"
              className="w-full px-3 py-2 bg-black border border-white/10 rounded text-xs text-white font-mono"
              autoComplete="new-password"
            />
            <p className="text-[9px] text-white/20">
              Clients must enter this password to see your station list.
            </p>
          </div>

          {/* Cloudflare Tunnel */}
          <div className="pt-2 border-t border-white/5 space-y-3">
            <div className="flex items-center gap-2">
              <Link size={11} className="text-orange-400" />
              <span className="text-[10px] text-white/40 uppercase tracking-wider">Cloudflare Tunnel (fast URL)</span>
            </div>
            <p className="text-[9px] text-white/20 leading-relaxed">
              Giver fast ekstern adresse uden port forwarding. Opret tunnel på cloudflare.com → Zero Trust → Tunnels.
            </p>
            <div>
              <label className="text-[10px] text-white/30 uppercase tracking-wider">Tunnel URL</label>
              <input
                type="text"
                value={cfTunnelUrl}
                onChange={e => setCfTunnelUrl(e.target.value)}
                placeholder="https://remote.ditdomæne.dk"
                className="w-full mt-1 px-3 py-2 bg-black border border-white/10 rounded text-xs text-white font-mono"
                spellCheck={false}
                autoCapitalize="none"
              />
            </div>
            <div>
              <label className="text-[10px] text-white/30 uppercase tracking-wider">Tunnel Token</label>
              <input
                type="password"
                value={cfTunnelToken}
                onChange={e => setCfTunnelToken(e.target.value)}
                placeholder="eyJ… (fra Cloudflare dashboard)"
                className="w-full mt-1 px-3 py-2 bg-black border border-white/10 rounded text-xs text-white font-mono"
                autoComplete="new-password"
              />
            </div>
            {cfTunnelUrl && cfTunnelToken && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ background: "rgba(249,115,22,0.08)", border: "1px solid rgba(249,115,22,0.2)" }}>
                <Globe size={10} className="text-orange-400 shrink-0" />
                <span className="text-[9px] text-orange-300 font-mono break-all">{cfTunnelUrl}</span>
              </div>
            )}
            <p className="text-[9px] text-white/20">Gemmes og tunnel genstarter automatisk ved Save.</p>
          </div>

          {/* Ports */}
          <div className="pt-2 border-t border-white/5 space-y-2">
            <div className="flex items-center gap-2">
              <Shield size={11} className="text-white/30" />
              <span className="text-[10px] text-white/40 uppercase tracking-wider">Ports</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] text-white/30 uppercase tracking-wider">HTTPS Port</label>
                <input
                  type="number"
                  value={port}
                  onChange={e => setPort(parseInt(e.target.value) || 3000)}
                  className="w-full mt-1 px-3 py-2 bg-black border border-white/10 rounded text-xs text-white font-mono"
                />
              </div>
              <div>
                <label className="text-[10px] text-white/30 uppercase tracking-wider">LAN Port (mobil)</label>
                <input
                  type="number"
                  value={lanPort}
                  onChange={e => setLanPort(parseInt(e.target.value) || 3001)}
                  className="w-full mt-1 px-3 py-2 bg-black border border-white/10 rounded text-xs text-white font-mono"
                />
              </div>
            </div>
            <p className="text-[9px] text-white/20">Kræver genstart for at træde i kraft.</p>
          </div>

          {/* Save */}
          <button
            onClick={saveConfig}
            disabled={saving}
            className="w-full py-2.5 bg-orange-600 hover:bg-orange-500 disabled:opacity-50 rounded-xl text-xs font-black text-white uppercase tracking-widest transition-colors flex items-center justify-center gap-2"
          >
            {saving ? (
              <><Loader size={13} className="animate-spin" /> Saving…</>
            ) : saveStatus === 'ok' ? (
              <><CheckCircle size={13} /> Saved</>
            ) : saveStatus === 'error' ? (
              'Error — is the server running?'
            ) : (
              'Save & Apply'
            )}
          </button>

          {/* Restart warning */}
          {restartNeeded && (
            <div className="rounded-xl p-3 space-y-2"
              style={{ background: "rgba(234,179,8,0.08)", border: "1px solid rgba(234,179,8,0.3)" }}>
              <div className="flex items-center gap-2">
                <AlertTriangle size={12} className="text-yellow-400 shrink-0" />
                <span className="text-[10px] text-yellow-300 font-bold">Genstart påkrævet</span>
              </div>
              <button
                onClick={handleRestart}
                disabled={restarting}
                className="w-full py-2 rounded-lg text-xs font-black uppercase tracking-widest flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
                style={{ background: "rgba(234,179,8,0.2)", color: "#fde047", border: "1px solid rgba(234,179,8,0.4)" }}
              >
                {restarting
                  ? <><Loader size={12} className="animate-spin" /> Genstarter…</>
                  : <><RotateCw size={12} /> Genstart server</>}
              </button>
            </div>
          )}

          <p className="text-[9px] text-white/20 text-center">
            Changes apply immediately and are persisted to .env
          </p>
        </div>

        {/* ── LOCAL NETWORK ────────────────────────────────────────────── */}
        <div className="bg-zinc-900 p-6 rounded-2xl border border-white/5 space-y-4">
          <div className="flex items-center gap-3">
            <Globe size={16} />
            <h3 className="text-sm font-bold text-white">Local Network</h3>
          </div>

          <div className="space-y-3">
            <div>
              <label className="text-[10px] text-white/30 uppercase tracking-wider">IP Address</label>
              <input
                type="text"
                value={network.ip}
                onChange={e => updateNet('ip', e.target.value)}
                className="w-full mt-1 px-3 py-2 bg-black border border-white/10 rounded text-xs text-white font-mono"
              />
              <p className="text-[9px] text-white/20 mt-1">Auto-detekteres fra server — kun synlig, ikke redigerbar i praksis.</p>
            </div>
            <div>
              <label className="text-[10px] text-white/30 uppercase tracking-wider">LAN Port (mobil)</label>
              <input
                type="number"
                value={network.port}
                readOnly
                className="w-full mt-1 px-3 py-2 bg-black border border-white/10 rounded text-xs text-white/50 font-mono cursor-not-allowed"
              />
              <p className="text-[9px] text-white/20 mt-1">Ændres under Internet Access → Ports.</p>
            </div>
          </div>
        </div>

        {/* ── PEERS ────────────────────────────────────────────────────── */}
        <div className="bg-zinc-900 p-6 rounded-2xl border border-white/5 flex flex-col lg:col-span-2">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <Users size={16} />
              <h3 className="text-sm font-bold text-white">Peers</h3>
            </div>
            <button
              onClick={refreshHosts}
              className="p-1.5 bg-white/5 hover:bg-white/10 rounded"
            >
              <RefreshCw size={13} className={scanning ? 'animate-spin' : ''} />
            </button>
          </div>

          <div className="flex-1 space-y-2 overflow-auto">
            {remoteHosts.length === 0 && (
              <div className="text-center py-8 text-white/20 text-xs">No peers found</div>
            )}
            {remoteHosts.map(host => (
              <div key={host.id} className="p-3 bg-zinc-800 rounded-lg border border-white/5">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-bold">{host.name}</span>
                  <span className={`text-[10px] px-2 py-0.5 rounded font-bold
                    ${host.status === 'online' ? 'bg-green-500/20 text-green-400' : 'bg-white/5 text-white/30'}`}>
                    {host.status}
                  </span>
                </div>
                <div className="text-xs text-white/30 mt-1">
                  {host.ip} · {host.clientsCount} clients
                </div>
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  )
}

export default NetworkPanel
