import { useState, useEffect, useRef, useCallback, memo } from "react"
import { Mic, Volume2, ArrowRight, RefreshCw, Radio, AlertCircle, Server } from "lucide-react"
import { socket, setAudioOutputDevice } from "../client/webrtc/intercom"
import { Client } from "../types"
import ServerCapturePanel from "./ServerCapturePanel"

type AudioDevice = { deviceId: string; label: string; kind: "audioinput" | "audiooutput" }

type InputRoute = {
  deviceId: string
  channel: number
  destination: string
  receiveChannel: number
}

type OutputRoute = { deviceId: string; channel: number; clientId: string }

const MAX_CHANNELS = 16
const STORAGE_KEY = "easycom_io_v5"
const METER_KEY = "easycom_meter_v5"

/* ---------- LEVEL BAR ---------- */
function Bar({ level, color }: { level: number; color: string }) {
  return (
    <div className="flex gap-px" style={{ width: 40, height: 12 }}>
      {Array.from({ length: 8 }, (_, i) => {
        const t = (i + 1) / 8; const on = level / 100 >= t
        return <div key={i} style={{ flex: 1, height: "100%", borderRadius: 1, background: on ? t > 0.85 ? "#ef4444" : t > 0.6 ? "#eab308" : color : "rgba(255,255,255,0.08)" }} />
      })}
    </div>
  )
}

/* ---------- BROWSER METER HOOK ---------- */
function useDeviceLevels(deviceId: string) {
  const [levels, setLevels] = useState<number[]>(Array(MAX_CHANNELS).fill(0))
  const prevId = useRef("")
  const stateRef = useRef({ ctx: null as AudioContext | null, stream: null as MediaStream | null, raf: null as number | null, stopped: false })

  useEffect(() => {
    if (deviceId === prevId.current) return
    prevId.current = deviceId
    const prev = stateRef.current
    prev.stopped = true
    if (prev.raf) cancelAnimationFrame(prev.raf)
    prev.stream?.getTracks().forEach(t => t.stop())
    prev.ctx?.close().catch(() => {})
    setLevels(Array(MAX_CHANNELS).fill(0))
    if (!deviceId) return

    const state = { ctx: null as AudioContext | null, stream: null as MediaStream | null, raf: null as number | null, stopped: false }
    stateRef.current = state

    ;(async () => {
      try {
        state.stream = await navigator.mediaDevices.getUserMedia({
          audio: { deviceId: { exact: deviceId }, echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: { ideal: MAX_CHANNELS, min: 1 } }
        })
        if (state.stopped) { state.stream.getTracks().forEach(t => t.stop()); return }
        const actualCh = Math.min(state.stream.getAudioTracks()[0].getSettings().channelCount ?? 1, MAX_CHANNELS)
        state.ctx = new AudioContext(); await state.ctx.resume()
        const src = state.ctx.createMediaStreamSource(state.stream)
        const analysers: AnalyserNode[] = []
        if (actualCh > 1) {
          const split = state.ctx.createChannelSplitter(actualCh)
          src.connect(split)
          for (let i = 0; i < MAX_CHANNELS; i++) {
            const a = state.ctx.createAnalyser(); a.fftSize = 1024; a.smoothingTimeConstant = 0.4
            if (i < actualCh) split.connect(a, i)
            analysers.push(a)
          }
        } else {
          const a = state.ctx.createAnalyser(); a.fftSize = 1024; a.smoothingTimeConstant = 0.4
          src.connect(a)
          for (let i = 0; i < MAX_CHANNELS; i++) analysers.push(a)
        }
        const bufs = analysers.map(a => new Float32Array(a.fftSize))
        const tick = () => {
          if (state.stopped) return
          setLevels(analysers.map((a, i) => {
            a.getFloatTimeDomainData(bufs[i])
            let s = 0; for (let j = 0; j < bufs[i].length; j++) s += bufs[i][j] * bufs[i][j]
            return Math.min(100, Math.sqrt(s / bufs[i].length) * 400)
          }))
          state.raf = requestAnimationFrame(tick)
        }
        tick()
      } catch (e) { console.error("Meter:", e) }
    })()

    // 🔥 Only cleanup browser meter stream – NOT the audio bridge
    return () => {
      state.stopped = true
      if (state.raf) cancelAnimationFrame(state.raf)
      state.stream?.getTracks().forEach(t => t.stop())
      state.ctx?.close().catch(() => {})
    }
  }, [deviceId])

  return levels
}

/* ---------- BROWSER PIPELINES (for browser inputs, not bridge) ---------- */
const pipelines = new Map<string, { stream: MediaStream; ctx: AudioContext; stop: () => void }>()

async function startBrowserPipeline(
  device: AudioDevice,
  channel: number,
  destination: string,
  receiveChannel: number,
  onStatus: (s: any) => void,
  clients_unused?: any,
  produceStreamFn?: (s: MediaStream) => Promise<void>
) {
  const key = `${device.deviceId}-${channel}`
  pipelines.get(key)?.stop(); pipelines.delete(key)
  onStatus({ status: "starting" })
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { deviceId: { exact: device.deviceId }, echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: { ideal: MAX_CHANNELS, min: 1 } }
    })
    const actualCh = Math.min(stream.getAudioTracks()[0].getSettings().channelCount ?? 1, MAX_CHANNELS)
    const idx = Math.min(channel - 1, actualCh - 1)
    const ctx = new AudioContext(); await ctx.resume()
    const src = ctx.createMediaStreamSource(stream)
    let outputStream: MediaStream
    if (actualCh > 1) {
      const splitter = ctx.createChannelSplitter(actualCh)
      const merger = ctx.createChannelMerger(1)
      const dest = ctx.createMediaStreamDestination()
      src.connect(splitter); splitter.connect(merger, idx, 0); merger.connect(dest)
      outputStream = dest.stream
    } else {
      const dest = ctx.createMediaStreamDestination(); src.connect(dest); outputStream = dest.stream
    }
    if (produceStreamFn) {
      await produceStreamFn(outputStream)
    }
    socket.emit("audio:pipeline:start", { channel, clientId: destination })
    onStatus({ status: "active" })
    pipelines.set(key, {
      stream, ctx,
      stop: () => {
        stream.getTracks().forEach(t => t.stop())
        ctx.close().catch(() => {})
        socket.emit("audio:pipeline:stop", { channel, clientId: destination })
      }
    })
  } catch (e: any) { onStatus({ status: "error", error: e.message }) }
}

/* ============================================================
   MAIN COMPONENT
   ============================================================ */
type Props = { clients: Client[]; theme?: "orange" | "blue" }

export default function AudioIOPanel({ clients, theme = "orange" }: Props) {

  const [inputs, setInputs] = useState<AudioDevice[]>([])
  const [outputs, setOutputs] = useState<AudioDevice[]>([])
  const [inputRoutes, setInputRoutes] = useState<InputRoute[]>([])
  const [outputRoutes, setOutputRoutes] = useState<OutputRoute[]>([])
  const [loading, setLoading] = useState(false)
  const [meterDeviceId, setMeterDeviceId] = useState(() => sessionStorage.getItem(METER_KEY) ?? "")
  const [pipelineStatuses, setPipelineStatuses] = useState<Record<string, any>>({})

  const accentColor = theme === "orange" ? "#f97316" : "#3b82f6"
  const meterLevels = useDeviceLevels(meterDeviceId)

  useEffect(() => {
    if (meterDeviceId) sessionStorage.setItem(METER_KEY, meterDeviceId)
    else sessionStorage.removeItem(METER_KEY)
  }, [meterDeviceId])

  useEffect(() => {
    try {
      const s = localStorage.getItem(STORAGE_KEY)
      if (s) {
        const p = JSON.parse(s)
        setInputRoutes(p.in ?? [])
        setOutputRoutes(p.out ?? [])
      }
    } catch {}
  }, [])

  const loadDevices = useCallback(async () => {
    setLoading(true)
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true }).catch(() => null)
      s?.getTracks().forEach(t => t.stop())
      const all = await navigator.mediaDevices.enumerateDevices()
      const real = (d: MediaDeviceInfo) =>
        d.deviceId !== "default" && d.deviceId !== "communications" &&
        !d.label.toLowerCase().startsWith("default ") &&
        !d.label.toLowerCase().startsWith("communications ")
      setInputs(all.filter(d => d.kind === "audioinput" && real(d)).map(d => ({
        deviceId: d.deviceId, label: d.label || `Input ${d.deviceId.slice(0, 6)}`, kind: "audioinput" as const
      })))
      setOutputs(all.filter(d => d.kind === "audiooutput" && real(d)).map(d => ({
        deviceId: d.deviceId, label: d.label || `Output ${d.deviceId.slice(0, 6)}`, kind: "audiooutput" as const
      })))
    } catch (e) { console.error(e) }
    setLoading(false)
  }, [])

  useEffect(() => {
    loadDevices()
    navigator.mediaDevices.addEventListener("devicechange", loadDevices)
    // 🔥 Only remove event listener – do NOT stop bridge
    return () => navigator.mediaDevices.removeEventListener("devicechange", loadDevices)
  }, [loadDevices])

  const setStatus = (key: string, info: any) =>
    setPipelineStatuses(prev => ({ ...prev, [key]: info }))

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/5 shrink-0">
        <div>
          <h2 className="text-sm font-bold">Audio I/O</h2>
          <p className="text-[10px] text-white/30">
            {inputs.length} inputs · {outputs.length} outputs
          </p>
        </div>
        <button onClick={loadDevices} disabled={loading} className="p-2 bg-white/5 hover:bg-white/10 rounded">
          <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
        </button>
      </div>

      <div className="flex-1 overflow-auto p-4 space-y-5">

        {/* 🔥 SERVER AUDIO BRIDGE – imports from separate file, persists across tab changes */}
        <div>
          <h3 className="text-[11px] font-bold text-orange-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <Server size={11} /> Server Audio Bridge
            <span className="text-[9px] font-normal text-white/20 normal-case">· Direkte Core Audio – anbefalet til Apollo</span>
          </h3>
          <ServerCapturePanel />
        </div>

        {/* BROWSER INPUTS */}
        {inputs.length > 0 && (
          <div>
            <h3 className="text-[11px] font-bold text-green-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <Mic size={11} /> Browser Audio Inputs
              <span className="text-[9px] font-normal text-white/20 normal-case">· Begrænset til hvad macOS eksponerer</span>
            </h3>
            <div className="space-y-3">
              {inputs.map(device => {
                const isMetering = device.deviceId === meterDeviceId
                const routes = inputRoutes.filter(r => r.deviceId === device.deviceId)
                return (
                  <div key={device.deviceId} className="rounded-xl overflow-hidden"
                    style={{ background: "rgba(255,255,255,0.02)", border: `1px solid ${isMetering ? "#22c55e30" : "rgba(255,255,255,0.05)"}` }}>
                    <div className="flex items-center justify-between px-3 py-2 cursor-pointer"
                      style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}
                      onClick={() => setMeterDeviceId(p => p === device.deviceId ? "" : device.deviceId)}>
                      <div className="flex items-center gap-2 min-w-0">
                        <Mic size={11} className="text-green-400 shrink-0" />
                        <p className="text-xs font-bold text-white truncate">{device.label}</p>
                      </div>
                      <div className="w-2 h-2 rounded-full shrink-0 ml-2"
                        style={{ background: isMetering ? "#22c55e" : "rgba(255,255,255,0.08)" }} />
                    </div>
                    <div className="divide-y divide-white/4">
                      {Array.from({ length: MAX_CHANNELS }, (_, i) => {
                        const ch = i + 1
                        const route = routes.find(r => r.channel === ch)
                        const level = isMetering ? (meterLevels[i] ?? 0) : 0
                        const isProducer = route?.destination === "producer"
                        const isClient = !!route && !isProducer
                        const destColor = isProducer ? "#f97316" : isClient ? "#3b82f6" : "transparent"
                        const key = `${device.deviceId}-${ch}`
                        const pInfo = pipelineStatuses[key]
                        return (
                          <div key={ch} className="flex items-center gap-2 px-3 py-1.5">
                            <div className="w-5 h-5 rounded flex items-center justify-center text-[9px] font-bold shrink-0"
                              style={{ background: route ? destColor + "20" : "rgba(255,255,255,0.04)", color: route ? destColor : "rgba(255,255,255,0.2)" }}>
                              {ch}
                            </div>
                            <Bar level={level} color="#22c55e" />
                            {pInfo?.status === "active" && <Radio size={8} className="shrink-0 text-orange-400 animate-pulse" />}
                            {pInfo?.status === "error" && <AlertCircle size={8} className="text-red-400 shrink-0" />}
                            {(!pInfo || pInfo.status === "idle") && <div className="w-[8px]" />}
                            <ArrowRight size={8} className="text-white/10 shrink-0" />
                            <select
                              value={route?.destination ?? ""}
                              onChange={e => {
                                const dest = e.target.value
                                pipelines.get(key)?.stop(); pipelines.delete(key)
                                const filtered = inputRoutes.filter(r => !(r.deviceId === device.deviceId && r.channel === ch))
                                const next = dest ? [...filtered, { deviceId: device.deviceId, channel: ch, destination: dest, receiveChannel: 1 }] : filtered
                                setInputRoutes(next)
                                try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ in: next, out: outputRoutes })) } catch {}
                                if (dest) {
                                  setStatus(key, { status: "starting" })
                                  startBrowserPipeline(device, ch, dest, 1, info => setStatus(key, info))
                                } else {
                                  setStatus(key, { status: "idle" })
                                }
                              }}
                              className="flex-1 bg-black border text-[9px] rounded px-1.5 py-1"
                              style={{ borderColor: "rgba(255,255,255,0.06)", color: route ? "white" : "rgba(255,255,255,0.25)" }}>
                              <option value="">— Ingen —</option>
                              <option value="producer">🎙 PRODUCER</option>
                              {clients.filter(c => c.id !== "producer-65").map(c =>
                                <option key={c.id} value={c.id}>{c.name}</option>
                              )}
                            </select>
                          </div>
                        )
                      })}
                    </div>
                    {pipelineStatuses[`${device.deviceId}-1`]?.status === "error" && (
                      <div className="mx-3 mb-2 px-2 py-1 rounded text-[9px] text-red-400"
                        style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.2)" }}>
                        {pipelineStatuses[`${device.deviceId}-1`]?.error}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* OUTPUTS */}
        {outputs.length > 0 && (
          <div>
            <h3 className="text-[11px] font-bold text-blue-400 uppercase tracking-wider mb-2 flex items-center gap-1">
              <Volume2 size={11} /> Audio Outputs
            </h3>
            <div className="space-y-2">
              {outputs.map(device => (
                <div key={device.deviceId} className="rounded-xl overflow-hidden"
                  style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)" }}>
                  <div className="flex items-center gap-2 px-3 py-2"
                    style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                    <Volume2 size={11} className="text-blue-400 shrink-0" />
                    <p className="text-xs font-bold text-white">{device.label}</p>
                  </div>
                  <div className="divide-y divide-white/4">
                    {Array.from({ length: MAX_CHANNELS }, (_, i) => {
                      const ch = i + 1
                      const route = outputRoutes.find(r => r.deviceId === device.deviceId && r.channel === ch)
                      return (
                        <div key={ch} className="flex items-center gap-2 px-3 py-1.5">
                          <div className="w-5 h-5 rounded flex items-center justify-center text-[9px] font-bold shrink-0"
                            style={{ background: route ? "#3b82f615" : "rgba(255,255,255,0.04)", color: route ? "#3b82f6" : "rgba(255,255,255,0.2)" }}>
                            {ch}
                          </div>
                          <div style={{ width: 48 }} />
                          <ArrowRight size={8} className="text-white/10 shrink-0" />
                          <select
                            value={route?.clientId ?? ""}
                            onChange={e => {
                              const clientId = e.target.value
                              const filtered = outputRoutes.filter(r => !(r.deviceId === device.deviceId && r.channel === ch))
                              const next = clientId ? [...filtered, { deviceId: device.deviceId, channel: ch, clientId }] : filtered
                              setOutputRoutes(next)
                              try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ in: inputRoutes, out: next })) } catch {}
                              if (clientId) socket.emit("audio:route", { deviceId: device.deviceId, channel: ch, clientId, kind: "audiooutput" })
                              else socket.emit("audio:route:remove", { deviceId: device.deviceId, channel: ch })
                            }}
                            className="flex-1 bg-black border text-[9px] rounded px-1.5 py-1"
                            style={{ borderColor: "rgba(255,255,255,0.06)", color: route ? "white" : "rgba(255,255,255,0.25)" }}>
                            <option value="">— Ingen —</option>
                            {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                          </select>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

      </div>
    </div>
  )
}
