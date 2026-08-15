import { useState, useEffect, useCallback, useRef } from "react"
import { Server, RefreshCw, AlertCircle, Loader, Settings, Check, X, Save, Volume2, Terminal, Trash2 } from "lucide-react"
import { socket, setAudioOutputDevice } from "../client/webrtc/intercom"
import { subscribeBridge, startBridgeCapture } from "../client/audio/audioBridgeStore"

type ChannelType = "input" | "output"
type ChannelInfo = { channel: number; name: string; type: ChannelType; autoDetected?: boolean }
type ServerDevice = {
  index: number; name: string; channels: number; sampleRate: number
  isApollo: boolean; channelInfo?: ChannelInfo[]
}
type Props = { onStreamReady?: (stream: MediaStream, channel: number) => void }

const IN_COLOR = "#22c55e"
const OUT_COLOR = "#3b82f6"

export default function ServerCapturePanel({ onStreamReady }: Props) {
  const [serverStatus, setServerStatus] = useState<"checking" | "unavailable" | "ready">("checking")
  const [serverError, setServerError] = useState("")
  const [devices, setDevices] = useState<ServerDevice[]>([])
  const [selectedDevice, setSelectedDevice] = useState<number | null>(null)
  const [activeTab, setActiveTab] = useState<"input" | "output">("input")
  const [displayLevels, setDisplayLevels] = useState<number[]>([])
  const [setupMode, setSetupMode] = useState(false)
  const [editingChannels, setEditingChannels] = useState<ChannelInfo[]>([])
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState("")
  const rawLevels = useRef<number[]>([])
  const startedDevices = useRef<Set<number>>(new Set())

  const [bridge, setBridge] = useState({
    totalChannels: 0,
    channels: [] as Array<{ channel: number; status: string; error?: string | null }>,
    channelInfo: [] as ChannelInfo[],
    deviceName: "",
  })

  const [outputDevices, setOutputDevices] = useState<MediaDeviceInfo[]>([])
  const [selectedOutputId, setSelectedOutputId] = useState<string>("default")

  // Debug log panel
  const [logLines, setLogLines] = useState<{ t: string; msg: string; level: "log" | "warn" | "error" }[]>([])
  const [showLog, setShowLog] = useState(true)
  const logRef = useRef<HTMLDivElement>(null)
  const logLinesRef = useRef(logLines)
  logLinesRef.current = logLines

  useEffect(() => {
    const KEEP = 120
    const fmt = (...args: any[]) => args.map(a => typeof a === "object" ? JSON.stringify(a) : String(a)).join(" ")
    const now = () => new Date().toLocaleTimeString("da-DK", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    const push = (level: "log" | "warn" | "error", msg: string) => {
      setLogLines(prev => [...prev.slice(-(KEEP - 1)), { t: now(), msg, level }])
    }
    const origLog = console.log
    const origWarn = console.warn
    const origError = console.error
    console.log = (...a) => { origLog(...a); push("log", fmt(...a)) }
    console.warn = (...a) => { origWarn(...a); push("warn", fmt(...a)) }
    console.error = (...a) => { origError(...a); push("error", fmt(...a)) }
    return () => { console.log = origLog; console.warn = origWarn; console.error = origError }
  }, [])

  useEffect(() => {
    if (showLog && logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [logLines, showLog])

  useEffect(() => {
    navigator.mediaDevices.enumerateDevices().then(devices => {
      const outs = devices.filter(d => d.kind === "audiooutput")
      setOutputDevices(outs)
    })
  }, [])

  const handleOutputChange = (deviceId: string) => {
    setSelectedOutputId(deviceId)
    setAudioOutputDevice(deviceId)
  }

  // Decay loop
  useEffect(() => {
    const id = setInterval(() => {
      setDisplayLevels(prev => prev.map((v, i) => {
        const raw = rawLevels.current[i] ?? 0
        return raw > v ? raw : Math.max(0, v - 5)
      }))
    }, 50)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    return subscribeBridge((s: any) => {
      setBridge({
        totalChannels: s.totalChannels || 0,
        channels: s.channels || [],
        channelInfo: s.channelInfo || [],
        deviceName: s.deviceName || "",
      })
      rawLevels.current = (s.channels || []).map((c: any) => c.level || 0)
      setDisplayLevels(prev =>
        prev.length !== (s.channels || []).length
          ? (s.channels || []).map((c: any) => c.level || 0)
          : prev
      )
      ;(s.channels || []).forEach((ch: any) => {
        if (ch.status === "active" && ch.stream) onStreamReady?.(ch.stream, ch.channel)
      })
    })
  }, [])

  const loadDevices = useCallback(() => {
    setServerStatus("checking"); setServerError("")
    const t = setTimeout(() => { setServerStatus("unavailable"); setServerError("Serveren svarer ikke") }, 5000)
    socket.emit("audio:devices:list", (res: any) => {
      clearTimeout(t)
      if (!res?.ok || !res.devices?.length) {
        setServerStatus("unavailable"); setServerError(res?.error ?? "Ingen lydenheder fundet"); return
      }
      setDevices(res.devices); setServerStatus("ready")
      const preferred = res.devices.find((d: ServerDevice) => d.isApollo) ?? res.devices[0]
      setSelectedDevice(preferred.index)
      if (!startedDevices.current.has(preferred.index)) {
        startedDevices.current.add(preferred.index)
        startBridgeCapture(preferred.index, preferred.name, 48000).catch(console.error)
      }
    })
  }, [])

  useEffect(() => { loadDevices() }, [loadDevices])

  const device = devices.find(d => d.index === selectedDevice)
  const isActive = bridge.channels.some(c => c.status === "active")
  const isStarting = bridge.channels.some(c => c.status === "starting")
  const isError = bridge.channels.length > 0 && !isActive && !isStarting
  const firstError = bridge.channels.find(c => c.status === "error")?.error ?? null

  const getChInfo = (ch: number): ChannelInfo => {
    return bridge.channelInfo.find(c => c.channel === ch)
      || device?.channelInfo?.find(c => c.channel === ch)
      || { channel: ch, name: `CH${ch}`, type: "input" }
  }

  const inputChannels = bridge.channels.filter(c => getChInfo(c.channel).type === "input")
  const outputChannels = bridge.channels.filter(c => getChInfo(c.channel).type === "output")
  const tabChannels = activeTab === "input" ? inputChannels : outputChannels
  const tabColor = activeTab === "input" ? IN_COLOR : OUT_COLOR

  const handleDeviceChange = (idx: number) => {
    setSelectedDevice(idx)
    const d = devices.find(x => x.index === idx)
    if (d) startBridgeCapture(idx, d.name, 48000).catch(console.error)
  }

  // Setup wizard
  const openSetup = () => {
    const chs = bridge.channels.map(c => ({ ...getChInfo(c.channel) }))
    setEditingChannels(chs)
    setSetupMode(true)
  }

  const saveSetup = async () => {
    setSaving(true); setSaveMsg("")
    socket.emit("audio:channel:config:save",
      { deviceName: bridge.deviceName, channelInfo: editingChannels },
      (res: any) => {
        setSaving(false)
        if (res?.ok) {
          setSaveMsg("✅ Gemt – genstart for at anvende")
          setTimeout(() => { setSaveMsg(""); setSetupMode(false) }, 2500)
        } else {
          setSaveMsg("❌ Gem fejlede: " + (res?.error || "ukendt fejl"))
        }
      }
    )
  }

  const updateEditCh = (ch: number, updates: Partial<ChannelInfo>) => {
    setEditingChannels(prev => prev.map(c => c.channel === ch ? { ...c, ...updates } : c))
  }

  // ---- SETUP WIZARD ----
  if (setupMode) {
    const editInputs = editingChannels.filter(c => c.type === "input")
    const editOutputs = editingChannels.filter(c => c.type === "output")

    return (
      <div className="rounded-xl overflow-hidden flex flex-col h-full"
        style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(249,115,22,0.4)" }}>
        <div className="flex items-center justify-between px-4 py-3 shrink-0"
          style={{ borderBottom: "1px solid rgba(255,255,255,0.08)", background: "rgba(0,0,0,0.3)" }}>
          <div>
            <p className="text-xs font-bold text-white">Kanal-opsætning</p>
            <p className="text-[10px] text-white/35">{bridge.deviceName}</p>
          </div>
          <button onClick={() => setSetupMode(false)} className="text-white/40 hover:text-white p-1"><X size={14} /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-1 min-h-0">
          <p className="text-[10px] text-white/40 pb-1">
            Klik IN/OUT for at ændre type · Klik navn for at omdøbe
          </p>
          {editingChannels.map(ch => (
            <div key={ch.channel} className="flex items-center gap-2 px-2.5 py-2 rounded-lg"
              style={{ background: "rgba(255,255,255,0.03)", border: `1px solid ${ch.type === "input" ? IN_COLOR : OUT_COLOR}18` }}>
              <span className="text-[9px] font-mono text-white/20 w-4 text-right shrink-0">{ch.channel}</span>
              {/* Type toggle */}
              <div className="flex gap-0.5 shrink-0">
                <button onClick={() => updateEditCh(ch.channel, { type: "input" })}
                  className="text-[8px] font-black px-1.5 py-0.5 rounded"
                  style={ch.type === "input"
                    ? { background: `${IN_COLOR}30`, color: IN_COLOR, border: `1px solid ${IN_COLOR}60` }
                    : { background: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.25)", border: "1px solid rgba(255,255,255,0.1)" }}>
                  IN
                </button>
                <button onClick={() => updateEditCh(ch.channel, { type: "output" })}
                  className="text-[8px] font-black px-1.5 py-0.5 rounded"
                  style={ch.type === "output"
                    ? { background: `${OUT_COLOR}30`, color: OUT_COLOR, border: `1px solid ${OUT_COLOR}60` }
                    : { background: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.25)", border: "1px solid rgba(255,255,255,0.1)" }}>
                  OUT
                </button>
              </div>
              {/* Navn */}
              <input
                value={ch.name}
                onChange={e => updateEditCh(ch.channel, { name: e.target.value })}
                className="flex-1 text-xs bg-transparent border-b border-white/10 text-white/80 px-1 py-0.5 focus:border-orange-400/60 focus:outline-none"
              />
              {ch.autoDetected && (
                <span className="text-[8px] text-white/20 shrink-0">auto</span>
              )}
            </div>
          ))}
        </div>
        <div className="p-3 shrink-0 space-y-2" style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
          {saveMsg && (
            <p className="text-[10px] text-center" style={{ color: saveMsg.startsWith("✅") ? IN_COLOR : "#ef4444" }}>
              {saveMsg}
            </p>
          )}
          <div className="flex items-center justify-between text-[10px] text-white/30 px-1">
            <span>{editInputs.length} inputs · {editOutputs.length} outputs</span>
            <span>Gemmes i audioDeviceConfig.json</span>
          </div>
          <button onClick={saveSetup} disabled={saving}
            className="w-full py-2.5 rounded-xl text-sm font-black flex items-center justify-center gap-2"
            style={{ background: saving ? "rgba(255,255,255,0.08)" : "#f97316", color: "white" }}>
            {saving ? <Loader size={14} className="animate-spin" /> : <Save size={14} />}
            {saving ? "Gemmer..." : "Gem opsætning"}
          </button>
        </div>
      </div>
    )
  }

  // ---- NORMAL VIEW ----
  return (
    <div className="rounded-xl overflow-hidden flex flex-col h-full"
      style={{ background: "rgba(255,255,255,0.02)", border: `1px solid ${isActive ? "rgba(249,115,22,0.3)" : "rgba(255,255,255,0.07)"}` }}>

      <div className="flex items-center justify-between px-4 py-3 shrink-0"
        style={{ borderBottom: "1px solid rgba(255,255,255,0.05)", background: "rgba(0,0,0,0.3)" }}>
        <div className="flex items-center gap-2.5">
          <Server size={14} className={isActive ? "text-orange-400" : "text-white/40"} />
          <div>
            <p className="text-xs font-bold text-white">Audio Bridge</p>
            <p className="text-[10px] text-white/35">
              {isActive ? `${bridge.deviceName} · ${inputChannels.length} inputs · ${outputChannels.length} outputs` : "Henter lydenheder..."}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {isActive && <span className="text-[8px] px-2 py-0.5 rounded font-bold mr-1" style={{ background: "#22c55e20", color: "#22c55e" }}>LIVE</span>}
          {isStarting && <Loader size={11} className="text-orange-400 animate-spin mr-1" />}
          {isActive && (
            <button onClick={openSetup} title="Opsæt kanal-navne og typer"
              className="p-1.5 rounded hover:bg-white/10 text-white/30 hover:text-orange-400">
              <Settings size={12} />
            </button>
          )}
          <button onClick={loadDevices} className="p-1.5 rounded hover:bg-white/10 text-white/30 hover:text-white" title="Genindlæs">
            <RefreshCw size={12} />
          </button>
        </div>
      </div>

      {/* Debug log panel */}
      <div className="shrink-0" style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
        <div className="flex items-center justify-between px-3 py-1.5"
          style={{ background: "rgba(0,0,0,0.4)" }}>
          <button onClick={() => setShowLog(p => !p)}
            className="flex items-center gap-1.5 text-[9px] font-black uppercase tracking-widest text-white/30 hover:text-white/60">
            <Terminal size={10} />
            Debug log {logLines.length > 0 && <span className="text-white/20">({logLines.length})</span>}
          </button>
          <div className="flex gap-1">
            <button onClick={() => setLogLines([])} title="Ryd log"
              className="p-1 rounded text-white/20 hover:text-white/50">
              <Trash2 size={9} />
            </button>
          </div>
        </div>
        {showLog && (
          <div ref={logRef}
            className="font-mono overflow-y-auto"
            style={{ height: 160, background: "rgba(0,0,0,0.6)", scrollbarWidth: "thin", scrollbarColor: "rgba(255,255,255,0.1) transparent" }}>
            {logLines.length === 0 && (
              <div className="flex items-center justify-center h-full text-[9px] text-white/15 italic">
                Afventer log…
              </div>
            )}
            {logLines.map((l, i) => (
              <div key={i} className="flex gap-1.5 px-2 py-0.5 hover:bg-white/5"
                style={{ borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
                <span className="text-[8px] text-white/20 shrink-0 pt-px">{l.t}</span>
                <span className="text-[9px] break-all leading-relaxed"
                  style={{ color: l.level === "error" ? "#f87171" : l.level === "warn" ? "#fbbf24" : "rgba(255,255,255,0.65)" }}>
                  {l.msg}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-col flex-1 min-h-0 p-3 gap-3">
        {serverStatus === "checking" && (
          <div className="flex items-center gap-2 text-[11px] text-white/30">
            <Loader size={11} className="animate-spin shrink-0" /> Finder lydenheder...
          </div>
        )}

        {serverStatus === "unavailable" && (
          <div className="px-3 py-2.5 rounded-lg flex items-start gap-2"
            style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)" }}>
            <AlertCircle size={12} className="text-red-400 shrink-0 mt-0.5" />
            <p className="text-[11px] text-red-300">{serverError}</p>
          </div>
        )}

        {serverStatus === "ready" && (
          <>
            <div className="shrink-0 space-y-1.5">
              <select value={selectedDevice ?? ""} onChange={e => handleDeviceChange(Number(e.target.value))}
                className="w-full bg-black/60 border border-white/10 rounded-lg px-3 py-2 text-xs text-white">
                {devices.map(d => (
                  <option key={d.index} value={d.index}>
                    {d.isApollo ? "🎛️ " : "💻 "}{d.name} ({d.channels} kanaler)
                  </option>
                ))}
              </select>
              {!isActive && !isStarting && (
                <button onClick={() => device && handleDeviceChange(device.index)}
                  className="w-full py-2 rounded-lg text-xs font-bold"
                  style={{ background: "#f97316", color: "white" }}>
                  Start bridge
                </button>
              )}
            </div>

            {isStarting && (
              <div className="flex items-center gap-2 text-[11px] text-white/40 shrink-0">
                <Loader size={11} className="animate-spin text-orange-400" />
                Starter – auto-detekterer kanaler...
              </div>
            )}

            {isError && (
              <div className="px-3 py-2.5 rounded-lg flex items-start gap-2 shrink-0"
                style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)" }}>
                <AlertCircle size={12} className="text-red-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-[11px] text-red-300 font-bold">AudioBridge fejlede</p>
                  {firstError && <p className="text-[10px] text-red-300/70 mt-0.5 break-all">{firstError}</p>}
                  <p className="text-[9px] text-white/25 mt-1">Se DevTools Console for detaljer</p>
                </div>
              </div>
            )}

            {/* Tabs */}
            {isActive && (
              <div className="flex gap-1.5 shrink-0">
                {[
                  { tab: "input" as const, label: "INPUTS", count: inputChannels.length, color: IN_COLOR },
                  { tab: "output" as const, label: "OUTPUTS", count: outputChannels.length, color: OUT_COLOR }
                ].map(({ tab, label, count, color }) => (
                  <button key={tab} onClick={() => setActiveTab(tab)}
                    className="flex-1 py-1.5 rounded-lg text-xs font-bold flex items-center justify-center gap-1"
                    style={activeTab === tab
                      ? { background: `${color}22`, color, border: `1px solid ${color}50` }
                      : { background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.3)", border: "1px solid rgba(255,255,255,0.07)" }}>
                    <span style={{ fontSize: 8 }}>●</span> {label}
                    <span className="opacity-50 text-[10px]">({count})</span>
                  </button>
                ))}
              </div>
            )}

            {/* Output device selector */}
            {isActive && outputDevices.length > 0 && (
              <div className="shrink-0 flex items-center gap-2 px-3 py-2 rounded-lg"
                style={{ background: "rgba(59,130,246,0.06)", border: "1px solid rgba(59,130,246,0.18)" }}>
                <Volume2 size={11} className="text-blue-400 shrink-0" />
                <select
                  value={selectedOutputId}
                  onChange={e => handleOutputChange(e.target.value)}
                  className="flex-1 bg-transparent text-xs text-white/80 focus:outline-none truncate"
                  style={{ minWidth: 0 }}
                >
                  {outputDevices.map(d => (
                    <option key={d.deviceId} value={d.deviceId} style={{ background: "#18181b" }}>
                      {d.label || `Output ${d.deviceId.slice(0, 8)}`}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Channel list */}
            {isActive && (
              <div className="flex-1 overflow-y-auto space-y-1 min-h-0"
                style={{ scrollbarWidth: "thin", scrollbarColor: `${tabColor}30 transparent` }}>
                {tabChannels.length === 0 && (
                  <div className="text-center py-6">
                    <p className="text-[11px] text-white/25 italic">Ingen {activeTab === "input" ? "inputs" : "outputs"}</p>
                    <button onClick={openSetup} className="mt-2 text-[10px] text-orange-400/70 hover:text-orange-400 flex items-center gap-1 mx-auto">
                      <Settings size={10} /> Åbn opsætning
                    </button>
                  </div>
                )}
                {tabChannels.map(ch => {
                  const idx = bridge.channels.findIndex(c => c.channel === ch.channel)
                  const info = getChInfo(ch.channel)
                  const color = info.type === "input" ? IN_COLOR : OUT_COLOR
                  const level = displayLevels[idx] ?? 0

                  return (
                    <div key={ch.channel}
                      className="flex items-center gap-2 px-3 py-2 rounded-lg"
                      style={{ background: "rgba(255,255,255,0.03)", border: `1px solid ${color}15` }}>
                      <span className="text-[9px] font-mono text-white/20 w-5 shrink-0 text-right">{ch.channel}</span>
                      <span className="text-[8px] font-black px-1.5 py-0.5 rounded shrink-0"
                        style={{ background: `${color}20`, color, border: `1px solid ${color}40` }}>
                        {info.type === "input" ? "IN" : "OUT"}
                      </span>
                      <span className="flex-1 text-xs font-medium text-white/80 truncate min-w-0">{info.name}</span>
                      <div className="w-20 shrink-0 space-y-0.5">
                        <div className="h-2.5 bg-black/60 rounded overflow-hidden">
                          <div className="h-full rounded"
                            style={{ width: `${Math.min(100, level)}%`, background: level > 85 ? "#ef4444" : level > 60 ? "#eab308" : color, transition: "none" }} />
                        </div>
                        <div className="text-[9px] font-mono text-right tabular-nums"
                          style={{ color: level > 2 ? color : "rgba(255,255,255,0.15)" }}>
                          {level.toFixed(0)}%
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}