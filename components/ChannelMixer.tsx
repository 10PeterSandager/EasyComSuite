import React, { useState, useRef, useEffect } from "react"
import { ChannelMixerSettings } from "../types"
import { X, Radio, Zap, Hand, Mic, Headphones, Users, ChevronDown, ChevronRight } from "lucide-react"
import { socket, startToneLevelMeter, stopToneLevelMeter, subscribeToLevels, setClientGain, setClientEQ, setClientGate, setClientMute, acquireConnection, releaseConnection } from "../client/webrtc/intercom"
import { produceStream, stopProducing } from "../client/webrtc/mediasoupClient"

// Global registry – allows HostView to trigger gain updates from mobile
export const _mixerUpdateIfb = { fn: null as ((i: number, patch: any) => void) | null }

type ToneMode = "auto" | "manual"

type Props = {
  channel: number
  clientName: string
  clientId: string
  settings: ChannelMixerSettings
  onChange: (s: ChannelMixerSettings) => void
  onClose: () => void
  theme?: "orange" | "blue"
  clients?: Array<{ id: string; name: string; talkNames?: Record<string, string> }>
  connections?: Array<{ from: string; to: string; channel: number }>
}

type ChSettings = {
  gain: number
  mute: boolean
  eq: { low: number; mid: number; high: number }
  gateEnabled: boolean
  gateThreshold: number
  toneActive?: boolean
  toneFreq?: number
  toneLevel?: number
  toneWave?: OscillatorType
  toneMode?: ToneMode
}

const defaultCh = (gain = 80): ChSettings => ({
  gain, mute: false, eq: { low: 0, mid: 0, high: 0 },
  gateEnabled: false, gateThreshold: -50,
  toneFreq: 1000, toneLevel: 50, toneWave: "sine", toneMode: "auto"
})

/* ---------- KNOB ---------- */
function Knob({ value, min, max, onChange, color = "#f97316", size = 40, label, unit, centerZero }: {
  value: number; min: number; max: number; onChange: (v: number) => void
  color?: string; size?: number; label?: string; unit?: string; centerZero?: boolean
}) {
  const drag = useRef<{ y: number; v: number } | null>(null)
  const pct = (value - min) / (max - min)
  const angle = -150 + pct * 300
  const r = size / 2 - 4; const cx = size / 2; const cy = size / 2
  const rad = (d: number) => d * Math.PI / 180
  const sa = rad(-240); const ea = rad(angle - 90)
  const ax1 = cx + r * Math.cos(sa); const ay1 = cy + r * Math.sin(sa)
  const ax2 = cx + r * Math.cos(ea); const ay2 = cy + r * Math.sin(ea)
  const la = angle + 150 > 180 ? 1 : 0
  const ix = cx + (r - 3) * Math.cos(ea); const iy = cy + (r - 3) * Math.sin(ea)
  useEffect(() => {
    const mv = (e: MouseEvent) => {
      if (!drag.current) return
      onChange(Math.max(min, Math.min(max, Math.round((drag.current.v + (drag.current.y - e.clientY) / 120 * (max - min)) * 10) / 10)))
    }
    const up = () => { drag.current = null; document.body.style.cursor = ""; document.body.style.userSelect = "" }
    window.addEventListener("mousemove", mv); window.addEventListener("mouseup", up)
    return () => { window.removeEventListener("mousemove", mv); window.removeEventListener("mouseup", up) }
  }, [min, max, onChange])
  return (
    <div className="flex flex-col items-center gap-0.5 select-none">
      <div style={{ width: size, height: size, cursor: "ns-resize" }}
        onMouseDown={e => { e.preventDefault(); drag.current = { y: e.clientY, v: value }; document.body.style.cursor = "ns-resize"; document.body.style.userSelect = "none" }}
        onDoubleClick={() => centerZero && onChange(0)}>
        <svg width={size} height={size}>
          <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="2.5" />
          {pct > 0 && <path d={`M ${ax1} ${ay1} A ${r} ${r} 0 ${la} 1 ${ax2} ${ay2}`} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" />}
          <circle cx={cx} cy={cy} r={r - 5} fill="#2a2a2a" stroke="rgba(255,255,255,0.08)" strokeWidth="1" />
          <circle cx={ix} cy={iy} r={2} fill={color} />
        </svg>
      </div>
      {label && <span className="text-[7px] text-white/25 uppercase tracking-widest leading-none">{label}</span>}
      {unit !== undefined && <span className="text-[8px] font-mono leading-none" style={{ color }}>{value > 0 && centerZero ? "+" : ""}{value.toFixed(0)}{unit}</span>}
    </div>
  )
}

/* ---------- MINI FADER ---------- */
function MiniFader({ value, onChange, color = "#f97316" }: { value: number; onChange: (v: number) => void; color?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)
  const pct = Math.max(0, Math.min(1, value / 100))
  const H = 100
  const getV = (y: number) => {
    const r = ref.current?.getBoundingClientRect()
    if (!r) return value
    return Math.round((1 - Math.max(0, Math.min(1, (y - r.top) / r.height))) * 100)
  }
  useEffect(() => {
    const mv = (e: MouseEvent) => { if (dragging.current) onChange(getV(e.clientY)) }
    const up = () => { dragging.current = false; document.body.style.userSelect = "" }
    window.addEventListener("mousemove", mv); window.addEventListener("mouseup", up)
    return () => { window.removeEventListener("mousemove", mv); window.removeEventListener("mouseup", up) }
  }, [onChange])
  return (
    <div className="flex flex-col items-center gap-1">
      <div ref={ref} style={{ height: H, width: 16, background: "linear-gradient(to top,#0a0a0a,#1a1a1a)", borderRadius: 8, cursor: "pointer", position: "relative" }}
        onMouseDown={e => { onChange(getV(e.clientY)); dragging.current = true; document.body.style.userSelect = "none" }}>
        <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: `${pct*100}%`, borderRadius: 8, background: `linear-gradient(to top,${color}99,${color}44)` }} />
        <div style={{ position: "absolute", left: "50%", transform: "translateX(-50%)", top: `calc(${(1-pct)*100}% - 6px)`, width: 14, height: 12, borderRadius: 3, background: "linear-gradient(135deg,#555,#222)", border: "1px solid rgba(255,255,255,0.2)" }}
          onMouseDown={e => { e.stopPropagation(); dragging.current = true }} />
      </div>
      <span className="text-[7px] font-mono" style={{ color }}>{value}</span>
    </div>
  )
}

/* ============================================================ TONE STATE ============================================================ */
let gCtx: AudioContext | null = null; let gOsc: OscillatorNode | null = null; let gGain: GainNode | null = null
let gAnalyser: AnalyserNode | null = null; let gDest: MediaStreamAudioDestinationNode | null = null
let gActive = false; let gClientId: string | null = null; let gMode: ToneMode = "auto"; let gIsProducing = false
const toneStateListeners = new Set<(active: boolean, ch: number) => void>()
let gCh = -1
function notifyToneState(active: boolean) { toneStateListeners.forEach(fn => fn(active, gCh)) }

async function startTone(freq: number, wave: OscillatorType, level: number, clientId: string, mode: ToneMode, ch: number): Promise<string | null> {
  if (gActive) stopToneGlobal()
  if (!clientId || clientId === "0") return `Invalid clientId`
  try {
    const ctx = new AudioContext(); await ctx.resume()
    gCtx = ctx; gMode = mode; gCh = ch
    const osc = ctx.createOscillator(); osc.type = wave; osc.frequency.value = freq; gOsc = osc
    const gain = ctx.createGain(); gain.gain.value = level / 200; gGain = gain
    const analyser = ctx.createAnalyser(); analyser.fftSize = 2048; gAnalyser = analyser
    const dest = ctx.createMediaStreamDestination(); gDest = dest
    osc.connect(gain); gain.connect(analyser); analyser.connect(dest)
    osc.start(); gActive = true; gClientId = clientId; gIsProducing = false; notifyToneState(true)
    startToneLevelMeter(analyser, "producer-65")
    if (mode === "auto") { try { await ((window as any).__easycomStopMicFully?.() ?? Promise.resolve()); await produceStream(dest.stream); gIsProducing = true; acquireConnection("producer-65", clientId, 1); socket.emit("tone:start", { clientId, freq, wave, level, mode }) } catch (e) { console.error(e) } }
    return null
  } catch (e: any) { gActive = false; notifyToneState(false); return e?.message ?? "Error" }
}

function stopToneGlobal() {
  stopToneLevelMeter()
  if (gOsc) { try { gOsc.stop() } catch {} gOsc = null }
  if (gCtx) { gCtx.close().catch(() => {}); gCtx = null }
  gGain = null; gAnalyser = null; gDest = null
  if (gActive && gClientId) {
    if (gMode === "auto") releaseConnection("producer-65", gClientId, 1)
    socket.emit("tone:stop", { clientId: gClientId })
    if (gIsProducing) { stopProducing().catch(() => {}); gIsProducing = false }
  }
  gActive = false; gClientId = null; gCh = -1; notifyToneState(false)
}

async function pttStart(): Promise<string | null> {
  if (!gActive || !gDest || gMode !== "manual" || gIsProducing) return null
  try { await produceStream(gDest.stream); gIsProducing = true; if (gClientId) socket.emit("tone:start", { clientId: gClientId, mode: "manual" }); return null }
  catch (e: any) { return e?.message ?? "Error" }
}
async function pttStop() {
  if (!gIsProducing || gMode !== "manual") return
  await stopProducing().catch(() => {}); gIsProducing = false; if (gClientId) socket.emit("tone:stop", { clientId: gClientId })
}

/* ---------- IFB CHANNEL ROW (tone only) ---------- */
function IfbChannelRow({ idx, ch, color, clientId, onUpdate }: {
  idx: number; ch: ChSettings; color: string; clientId: string; onUpdate: (patch: Partial<ChSettings>) => void
}) {
  const [toneOn, setToneOn] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [pttHeld, setPttHeld] = useState(false)
  const pttRef = useRef(false)
  const [toneErr, setToneErr] = useState<string | null>(null)

  useEffect(() => {
    const listener = (active: boolean, activeCh: number) => {
      if (activeCh === idx) setToneOn(active)
      else if (toneOn && !active) setToneOn(false)
    }
    toneStateListeners.add(listener)
    return () => { toneStateListeners.delete(listener) }
  }, [idx, toneOn])

  const isActive = toneOn && gCh === idx

  const handleTone = async () => {
    setToneErr(null)
    if (gActive && gCh === idx) stopToneGlobal()
    else { const err = await startTone(ch.toneFreq ?? 1000, ch.toneWave ?? "sine", ch.toneLevel ?? 50, clientId, ch.toneMode ?? "auto", idx); if (err) setToneErr(err) }
  }
  const handlePttDown = async (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId); if (pttRef.current) return
    pttRef.current = true; setPttHeld(true); const err = await pttStart(); if (err) setToneErr(err)
  }
  const handlePttUp = async (e: React.PointerEvent) => {
    e.currentTarget.releasePointerCapture(e.pointerId); pttRef.current = false; setPttHeld(false); await pttStop()
  }

  return (
    <div className="rounded-lg mb-1.5 overflow-hidden" style={{ border: `1px solid ${isActive ? color+"60" : "rgba(255,255,255,0.06)"}`, background: isActive ? color+"08" : "transparent" }}>
      <div className="flex items-center gap-2 px-2 py-1.5">
        <span className="text-[9px] font-black uppercase tracking-wider shrink-0" style={{ color: color+"cc", minWidth: 40 }}>
          IFB {idx + 1}
        </span>
        <button onClick={handleTone}
          className="flex-1 py-1.5 rounded text-[8px] font-black uppercase"
          style={isActive ? { background: "#ef4444", color: "white" } : { background: color+"20", color, border: `1px solid ${color}40` }}>
          {isActive ? "■ STOP" : "TONE"}
        </button>
        {isActive && (ch.toneMode ?? "auto") === "manual" && (
          <button onPointerDown={handlePttDown} onPointerUp={handlePttUp} onPointerCancel={handlePttUp}
            className="px-2 py-1.5 rounded font-black uppercase text-[8px] flex items-center gap-1 touch-none"
            style={pttHeld ? { background: "#22c55e", color: "white" } : { background: "rgba(59,130,246,0.2)", border: "1px solid #3b82f6", color: "#3b82f6" }}>
            <Mic size={9} /> PTT
          </button>
        )}
        <button onClick={() => setShowSettings(p => !p)} className="p-1 text-white/20 hover:text-white/60 shrink-0">
          <ChevronDown size={10} style={{ transform: showSettings ? "rotate(180deg)" : "none", transition: "transform 0.15s" }} />
        </button>
      </div>
      {showSettings && (
        <div className="px-3 pb-3 pt-1 space-y-2" style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
          <div className="flex gap-1">
            {(["auto","manual"] as ToneMode[]).map(m => (
              <button key={m} onClick={() => { onUpdate({ toneMode: m }); if (gActive && gCh === idx) gMode = m }}
                className="flex-1 py-1 rounded text-[7px] font-black uppercase"
                style={(ch.toneMode ?? "auto") === m ? { background: color+"25", border: `1px solid ${color}`, color } : { background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.35)" }}>
                {m}
              </button>
            ))}
          </div>
          <div className="flex gap-1 flex-wrap">
            {[100, 440, 1000, 5000].map(f => (
              <button key={f} onClick={() => { onUpdate({ toneFreq: f }); if (gOsc && gCtx && gCh === idx) gOsc.frequency.setTargetAtTime(f, gCtx.currentTime, 0.01) }}
                className="px-2 py-0.5 rounded text-[7px] font-bold"
                style={(ch.toneFreq ?? 1000) === f ? { background: color+"25", border: `1px solid ${color}`, color } : { background: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.4)" }}>
                {f >= 1000 ? `${f/1000}k` : f}Hz
              </button>
            ))}
            <select value={ch.toneWave ?? "sine"} onChange={e => { const w = e.target.value as OscillatorType; onUpdate({ toneWave: w }); if (gOsc && gCh === idx) gOsc.type = w }}
              className="flex-1 bg-black border border-white/10 rounded px-1 py-0.5 text-[7px] text-white/60 outline-none">
              {["sine","square","sawtooth","triangle"].map(w => <option key={w} value={w}>{w}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[7px] text-white/30 shrink-0">Level</span>
            <input type="range" min={0} max={100} value={ch.toneLevel ?? 50}
              onChange={e => { const v = Number(e.target.value); onUpdate({ toneLevel: v }); if (gGain && gCtx && gCh === idx) gGain.gain.setTargetAtTime(v/200, gCtx.currentTime, 0.01) }}
              className="flex-1 h-1 rounded cursor-pointer appearance-none" style={{ accentColor: color }} />
            <span className="text-[7px] font-mono text-white/40 w-7">{ch.toneLevel ?? 50}%</span>
          </div>
          {toneErr && <div className="text-[7px] text-red-400">{toneErr}</div>}
        </div>
      )}
    </div>
  )
}

/* ---------- CLIENT CHANNEL ROW ---------- */
function ClientChannelRow({ idx, ch, color, label, onUpdate }: {
  idx: number; ch: ChSettings; color: string; label: string; onUpdate: (patch: Partial<ChSettings>) => void
}) {
  const [expanded, setExpanded] = useState(false)
  return (
    <div className="rounded-lg overflow-hidden mb-1.5" style={{ border: `1px solid ${ch.mute ? "#ef444440" : expanded ? color+"30" : "rgba(255,255,255,0.07)"}` }}>
      <div className="flex items-center gap-2 px-2 py-1.5 cursor-pointer"
        style={{ background: expanded ? color+"0d" : "transparent" }}
        onClick={() => setExpanded(p => !p)}>
        {expanded ? <ChevronDown size={10} style={{ color }} /> : <ChevronRight size={10} className="text-white/20" />}
        <span className="text-[9px] font-black uppercase tracking-wider flex-1" style={{ color: ch.mute ? "#ef4444" : color+"cc" }}>{label}</span>
        <div className="w-14 h-1 rounded-full bg-white/5 overflow-hidden">
          <div className="h-full rounded-full" style={{ width: `${ch.gain}%`, background: ch.mute ? "#ef4444" : color, opacity: 0.6 }} />
        </div>
        <button onClick={e => { e.stopPropagation(); onUpdate({ mute: !ch.mute }) }}
          className="px-1.5 py-0.5 rounded text-[7px] font-black uppercase"
          style={ch.mute ? { background: "#ef444420", color: "#ef4444", border: "1px solid #ef444440" } : { background: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.3)", border: "1px solid rgba(255,255,255,0.08)" }}>
          {ch.mute ? "MUTED" : "MUTE"}
        </button>
      </div>
      {expanded && (
        <div className="px-3 pb-3 pt-1 border-t border-white/5 space-y-2">
          <div className="flex gap-3 items-center">
            <div className="flex flex-col items-center gap-0.5">
              <MiniFader value={ch.gain} onChange={v => onUpdate({ gain: v })} color={color} />
              <span className="text-[7px] text-white/20">GAIN</span>
            </div>
            <div className="flex-1">
              <div className="text-[7px] text-white/20 uppercase tracking-widest mb-1">EQ</div>
              <div className="flex justify-between">
                {(["high","mid","low"] as const).map((b, bi) => (
                  <Knob key={b} value={ch.eq[b]} min={-12} max={12}
                    onChange={v => onUpdate({ eq: { ...ch.eq, [b]: v } })}
                    color={color} size={34} label={["HI","MID","LO"][bi]} unit="dB" centerZero />
                ))}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 px-2 py-1.5 rounded" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
            <span className="text-[7px] text-white/30 uppercase tracking-widest flex-1">Gate</span>
            <button onClick={() => onUpdate({ gateEnabled: !ch.gateEnabled })}
              className="relative w-7 h-3.5 rounded-full" style={{ background: ch.gateEnabled ? color : "rgba(255,255,255,0.1)" }}>
              <div className="absolute top-0.5 w-2.5 h-2.5 rounded-full bg-white shadow" style={{ left: ch.gateEnabled ? "14px" : "2px", transition: "left 0.15s" }} />
            </button>
            <Knob value={ch.gateThreshold} min={-100} max={0} onChange={v => onUpdate({ gateThreshold: v })}
              color={ch.gateEnabled ? color : "#444"} size={30} unit="dB" />
          </div>
        </div>
      )}
    </div>
  )
}

/* ---------- MAIN COMPONENT ---------- */
const ChannelMixer: React.FC<Props> = ({ channel, clientName, clientId, settings, onChange, onClose, theme = "orange", clients = [], connections = [] }) => {
  const color = theme === "orange" ? "#f97316" : "#3b82f6"
  const ifbColor = "#22c55e"
  const clientColor = "#a855f7"

  const [ifbChs, setIfbChs] = useState<ChSettings[]>(
    (settings as any).ifbChs ?? Array.from({ length: 8 }, () => defaultCh(80))
  )
  const [clientChs, setClientChs] = useState<ChSettings[]>(
    (settings as any).clientChs ?? Array.from({ length: 4 }, () => defaultCh(80))
  )
  const [scale, setScale] = useState(1)

const updateIfb = (i: number, patch: Partial<ChSettings>) => {
    const next = ifbChs.map((c, idx) => idx === i ? { ...c, ...patch } : c)
    setIfbChs(next)
    onChange({ ...settings, ...(settings as any), ifbChs: next } as any)
  }

  // Register in global registry so HostView can call it from mobile gain events
  useEffect(() => {
    _mixerUpdateIfb.fn = updateIfb
    return () => { _mixerUpdateIfb.fn = null }
  })

  const updateClient = (i: number, patch: Partial<ChSettings>) => {
    const next = clientChs.map((c, idx) => idx === i ? { ...c, ...patch } : c)
    setClientChs(next)
    onChange({ ...settings, ...(settings as any), clientChs: next } as any)
    const ch = next[i]
    if (patch.gain !== undefined) setClientGain(clientId, patch.gain / 100)
    if (patch.eq !== undefined) {
      setClientEQ(clientId, 'low', patch.eq.low)
      setClientEQ(clientId, 'mid', patch.eq.mid)
      setClientEQ(clientId, 'high', patch.eq.high)
    }
    if (patch.gateEnabled !== undefined || patch.gateThreshold !== undefined)
      setClientGate(clientId, ch.gateEnabled, ch.gateThreshold)
    if (patch.mute !== undefined) setClientMute(clientId, patch.mute)
  }

  const getClientChLabel = (i: number) => {
    for (const c of clients) {
      const name = (c as any).talkNames?.[`talk${(i % 4) + 1}`]
      if (name) return name
    }
    return `Talk ${i + 1}`
  }

  return (
    <div className="flex flex-col rounded-b-2xl overflow-hidden shadow-2xl"
      style={{ width: Math.round(340 * scale), background: "linear-gradient(160deg,#1c1c1e,#111)", border: "1px solid rgba(255,255,255,0.08)", borderTop: "none" }}>

      {/* TOOLBAR */}
      <div className="flex items-center justify-between px-3 py-1.5 shrink-0"
        style={{ background: "#0a0a0a", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full" style={{ background: color }} />
          <span className="text-xs font-bold text-white">{clientName}</span>
          <span className="text-[9px] text-white/30">CH{channel}</span>
        </div>
        <div className="flex items-center gap-2">
          {/* Scale */}
          <div className="flex items-center gap-1">
            <button onClick={() => setScale(s => Math.max(0.7, +(s - 0.1).toFixed(1)))} className="w-5 h-5 rounded bg-white/5 hover:bg-white/10 text-white/40 text-xs flex items-center justify-center">−</button>
            <span className="text-[8px] text-white/30 w-8 text-center">{Math.round(scale*100)}%</span>
            <button onClick={() => setScale(s => Math.min(1.5, +(s + 0.1).toFixed(1)))} className="w-5 h-5 rounded bg-white/5 hover:bg-white/10 text-white/40 text-xs flex items-center justify-center">+</button>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-white/10 text-white/30 hover:text-white"><X size={13} /></button>
        </div>
      </div>

      {/* SCROLLABLE BODY */}
      <div className="overflow-y-auto" style={{ maxHeight: 520, fontSize: `${scale}em` }}>

        {/* IFB SECTION */}
        <div className="px-3 py-2 border-b border-white/5">
          <div className="flex items-center gap-2 mb-2">
            <Headphones size={11} style={{ color: ifbColor }} />
            <span className="text-[9px] font-black uppercase tracking-widest" style={{ color: ifbColor+"cc" }}>IFB – 8 Channels</span>
          </div>
          {ifbChs.map((ch, i) => (
            <IfbChannelRow key={i} idx={i} ch={ch} color={ifbColor} clientId={clientId} onUpdate={p => updateIfb(i, p)} />
          ))}
        </div>

        {/* CLIENT CHANNELS SECTION */}
        <div className="px-3 py-2">
          <div className="flex items-center gap-2 mb-2">
            <Users size={11} style={{ color: clientColor }} />
            <span className="text-[9px] font-black uppercase tracking-widest" style={{ color: clientColor+"cc" }}>Client Channels – 4 Incoming</span>
          </div>
          {clientChs.map((ch, i) => (
            <ClientChannelRow key={i} idx={i} ch={ch} color={clientColor} label={getClientChLabel(i)} onUpdate={p => updateClient(i, p)} />
          ))}
        </div>

      </div>
    </div>
  )
}

export default ChannelMixer
