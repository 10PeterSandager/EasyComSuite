import { useState, useEffect, useRef } from "react"
import { Bug, X, RefreshCw, CheckCircle, XCircle, AlertCircle } from "lucide-react"

type LogEntry = { time: string; level: "info" | "ok" | "warn" | "error"; msg: string }

let globalLogs: LogEntry[] = []
const logListeners = new Set<() => void>()

export function debugLog(level: LogEntry["level"], msg: string) {
  const entry = { time: new Date().toLocaleTimeString("da-DK", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" }), level, msg }
  globalLogs = [entry, ...globalLogs].slice(0, 60)
  logListeners.forEach(fn => fn())
  const c = level === "error" ? console.error : level === "warn" ? console.warn : console.log
  c(`[AudioDebug] ${msg}`)
}

export default function AudioDebugPanel({ onClose }: { onClose: () => void }) {
  const [logs, setLogs] = useState<LogEntry[]>(globalLogs)
  const [running, setRunning] = useState(false)
  const [deviceId, setDeviceId] = useState("")
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [liveLevel, setLiveLevel] = useState<number[]>([])
  const stopRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    const fn = () => setLogs([...globalLogs])
    logListeners.add(fn)
return () => {
  logListeners.delete(fn)
}  }, [])

  useEffect(() => {
    navigator.mediaDevices.enumerateDevices().then(all => {
      setDevices(all.filter(d => d.kind === "audioinput"))
    })
  }, [])

  const runDiagnostic = async () => {
    stopRef.current?.()
    stopRef.current = null
    setRunning(true)
    setLiveLevel([])
    globalLogs = []
    setLogs([])

    debugLog("info", "=== Starter audio diagnostik ===")

    // 1. Permission
    debugLog("info", "1. Tester mikrofonadgang...")
    try {
      const perm = await navigator.permissions.query({ name: "microphone" as PermissionName })
      debugLog(perm.state === "granted" ? "ok" : "warn", `Tilladelse: ${perm.state}`)
    } catch { debugLog("warn", "Kan ikke tjekke tilladelse via permissions API") }

    // 2. getUserMedia
    debugLog("info", "2. Kalder getUserMedia...")
    let stream: MediaStream | null = null
    try {
      const constraints: MediaStreamConstraints = {
        audio: deviceId
          ? { deviceId: { exact: deviceId }, echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: { ideal: 8, min: 1 } }
          : { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
      }
      debugLog("info", `Constraints: ${JSON.stringify(constraints.audio)}`)
      stream = await navigator.mediaDevices.getUserMedia(constraints)
      const track = stream.getAudioTracks()[0]
      const settings = track.getSettings()
      debugLog("ok", `✅ Stream OK! Track: "${track.label}"`)
      debugLog("ok", `   Channels: ${settings.channelCount ?? "ukendt"}, SampleRate: ${settings.sampleRate ?? "ukendt"}`)
      debugLog("info", `   Fuld settings: ${JSON.stringify(settings)}`)
    } catch (e: any) {
      debugLog("error", `❌ getUserMedia fejl: ${e.name}: ${e.message}`)
      setRunning(false)
      return
    }

    // 3. AudioContext
    debugLog("info", "3. Opretter AudioContext...")
    let ctx: AudioContext | null = null
    try {
      ctx = new AudioContext()
      debugLog("info", `   AudioContext state FØR resume: ${ctx.state}`)
      await ctx.resume()
      debugLog(ctx.state === "running" ? "ok" : "error", `   AudioContext state EFTER resume: ${ctx.state}`)
      if (ctx.state !== "running") {
        debugLog("warn", "   AudioContext er ikke running – prøv at klikke et sted på siden først")
      }
    } catch (e: any) {
      debugLog("error", `❌ AudioContext fejl: ${e.message}`)
      stream.getTracks().forEach(t => t.stop())
      setRunning(false)
      return
    }

    // 4. Analyser
    debugLog("info", "4. Tilslutter AnalyserNode...")
    const src = ctx.createMediaStreamSource(stream)
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 2048
    analyser.smoothingTimeConstant = 0.3
    src.connect(analyser)
    debugLog("ok", `   Analyser tilsluttet. FFT size: ${analyser.fftSize}`)

    // 5. Live måling
    debugLog("info", "5. Starter RMS måling (10 sekunder)...")
    const buf = new Float32Array(analyser.fftSize)
    let frameCount = 0
    let maxRMS = 0
    let stopped = false
    let raf: number

    const tick = () => {
      if (stopped) return
      analyser.getFloatTimeDomainData(buf)
      let sum = 0
      for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i]
      const rms = Math.sqrt(sum / buf.length)
      const level = Math.min(100, rms * 400)

      if (level > maxRMS) {
        maxRMS = level
        if (frameCount % 30 === 0 || level > 5) {
          debugLog(level > 5 ? "ok" : "info", `   RMS: ${rms.toFixed(6)} → level: ${level.toFixed(1)}% ${level > 5 ? "🎙 LYD DETEKTERET!" : ""}`)
        }
      }

      setLiveLevel(prev => {
        const next = [...prev, level].slice(-60)
        return next
      })

      frameCount++
      raf = requestAnimationFrame(tick)
    }

    raf = requestAnimationFrame(tick)

    stopRef.current = () => {
      stopped = true
      cancelAnimationFrame(raf)
      stream!.getTracks().forEach(t => t.stop())
      ctx!.close()
      setRunning(false)
      debugLog("info", `=== Stoppet. Max level: ${maxRMS.toFixed(1)}% over ${frameCount} frames ===`)
      if (maxRMS < 1) {
        debugLog("error", "❌ INGEN LYD DETEKTERET! Mulige årsager:")
        debugLog("warn", "   - Forkert input valgt i macOS lydindstillinger?")
        debugLog("warn", "   - Apollo: Er kanalen aktiv i Console?")
        debugLog("warn", "   - Browser tillader kun mono selvom du beder om multi-ch?")
        debugLog("warn", "   - Prøv: Gå til Systemindstillinger > Lyd > Input og check level-meter der")
      }
    }

    // Auto-stop after 10s
    setTimeout(() => { stopRef.current?.(); stopRef.current = null }, 10000)
  }

  const iconFor = (level: LogEntry["level"]) => {
    if (level === "ok") return <CheckCircle size={10} className="text-green-400 shrink-0" />
    if (level === "error") return <XCircle size={10} className="text-red-400 shrink-0" />
    if (level === "warn") return <AlertCircle size={10} className="text-yellow-400 shrink-0" />
    return <div className="w-[10px] h-[10px] rounded-full bg-white/20 shrink-0" />
  }

  const colorFor = (level: LogEntry["level"]) => {
    if (level === "ok") return "text-green-300"
    if (level === "error") return "text-red-300"
    if (level === "warn") return "text-yellow-300"
    return "text-white/60"
  }

  const maxLevel = Math.max(...liveLevel, 0)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="w-[600px] max-h-[80vh] flex flex-col rounded-2xl overflow-hidden"
        style={{ background: "#0a0a0a", border: "1px solid rgba(255,255,255,0.1)" }}>

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
          <div className="flex items-center gap-2">
            <Bug size={14} className="text-yellow-400" />
            <span className="font-bold text-sm">Audio Input Diagnostik</span>
          </div>
          <button onClick={() => { stopRef.current?.(); onClose() }} className="hover:text-white text-white/40"><X size={14} /></button>
        </div>

        {/* Controls */}
        <div className="p-4 border-b border-white/10 space-y-3">
          <div className="flex gap-2">
            <select
              value={deviceId}
              onChange={e => setDeviceId(e.target.value)}
              className="flex-1 bg-black border border-white/10 rounded px-2 py-1.5 text-xs text-white"
            >
              <option value="">Standard mikrofon</option>
              {devices.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || d.deviceId.slice(0, 20)}</option>)}
            </select>
            <button
              onClick={running ? () => { stopRef.current?.(); stopRef.current = null } : runDiagnostic}
              className="px-4 py-1.5 rounded text-xs font-bold flex items-center gap-1.5"
              style={running
                ? { background: "#ef4444", color: "white" }
                : { background: "#f97316", color: "white" }
              }
            >
              {running ? <><X size={11} /> Stop</> : <><RefreshCw size={11} /> Kør test</>}
            </button>
          </div>

          {/* Live level */}
          {liveLevel.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] text-white/40">Live RMS niveau</span>
                <span className={`text-[10px] font-mono font-bold ${maxLevel > 5 ? "text-green-400" : "text-red-400"}`}>
                  {maxLevel > 5 ? `✅ ${maxLevel.toFixed(1)}% – LYD OK` : `❌ ${maxLevel.toFixed(1)}% – INGEN LYD`}
                </span>
              </div>
              <div className="h-8 bg-black rounded overflow-hidden flex items-end gap-px">
                {liveLevel.map((v, i) => (
                  <div key={i} style={{
                    flex: 1, height: `${Math.max(2, v)}%`,
                    background: v > 75 ? "#ef4444" : v > 40 ? "#eab308" : v > 5 ? "#22c55e" : "#333"
                  }} />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Log output */}
        <div className="flex-1 overflow-auto p-3 space-y-1 font-mono">
          {logs.length === 0 && (
            <p className="text-white/20 text-xs text-center py-8">Tryk "Kør test" for at starte diagnostik</p>
          )}
          {logs.map((log, i) => (
            <div key={i} className="flex items-start gap-2 text-[10px]">
              <span className="text-white/20 shrink-0">{log.time}</span>
              {iconFor(log.level)}
              <span className={colorFor(log.level)}>{log.msg}</span>
            </div>
          ))}
        </div>

        <div className="px-4 py-2 border-t border-white/10">
          <p className="text-[9px] text-white/20">
            Tip: Klik et sted på siden FØR du kører testen – AudioContext kræver brugerinteraktion.
            Tjek også macOS Systemindstillinger → Lyd → Input at Apollo er valgt og har signal.
          </p>
        </div>
      </div>
    </div>
  )
}
