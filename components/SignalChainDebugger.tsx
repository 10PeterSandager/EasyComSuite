import { useState, useEffect, useRef, useCallback } from "react"
import { X, Play, Square, RefreshCw, AlertCircle, CheckCircle } from "lucide-react"

// A single horizontal level bar
function LevelBar({ level, label, sublabel, color = "#22c55e" }: { level: number; label: string; sublabel?: string; color?: string }) {
  const pct = Math.min(100, level)
  const hasSignal = level > 2
  return (
    <div className="flex items-center gap-3">
      <div className="w-36 shrink-0">
        <p className="text-[10px] font-bold text-white">{label}</p>
        {sublabel && <p className="text-[9px] text-white/30">{sublabel}</p>}
      </div>
      <div className="flex-1 h-5 bg-black rounded overflow-hidden relative">
        <div className="h-full rounded transition-all duration-75"
          style={{ width: `${pct}%`, background: pct > 85 ? "#ef4444" : pct > 60 ? "#eab308" : color }} />
        <span className="absolute right-1 top-0 bottom-0 flex items-center text-[9px] font-mono text-white/40">
          {level.toFixed(1)}%
        </span>
      </div>
      <div className="shrink-0">
        {hasSignal
          ? <CheckCircle size={14} className="text-green-400" />
          : <AlertCircle size={14} className="text-white/15" />
        }
      </div>
    </div>
  )
}

// Multi-channel bar (for split channels)
function MultiChannelBar({ levels, label }: { levels: number[]; label: string }) {
  return (
    <div>
      <p className="text-[10px] font-bold text-white mb-1">{label}</p>
      <div className="space-y-1">
        {levels.map((level, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="text-[9px] font-mono text-white/30 w-6 shrink-0">CH{i+1}</span>
            <div className="flex-1 h-3 bg-black rounded overflow-hidden">
              <div className="h-full rounded transition-all duration-75"
                style={{ width: `${Math.min(100, level)}%`, background: level > 85 ? "#ef4444" : level > 60 ? "#eab308" : "#22c55e" }} />
            </div>
            <span className="text-[8px] font-mono text-white/30 w-8 text-right">{level.toFixed(0)}%</span>
          </div>
        ))}
      </div>
    </div>
  )
}

type Props = { onClose: () => void }

export default function SignalChainDebugger({ onClose }: Props) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [selectedDevice, setSelectedDevice] = useState("")
  const [running, setRunning] = useState(false)

  // Tone generator
  const [toneActive, setToneActive] = useState(false)
  const [toneFreq, setToneFreq] = useState(1000)
  const [toneLevel, setToneLevel] = useState(50)

  // Signal chain levels
  const [rawLevels, setRawLevels] = useState<number[]>([0, 0, 0, 0, 0, 0, 0, 0])
  const [toneLevel_meter, setToneLevelMeter] = useState(0)
  const [mixedLevel, setMixedLevel] = useState(0)
  const [webrtcLevel, setWebrtcLevel] = useState(0)

  // Status messages
  const [status, setStatus] = useState<string[]>([])
  const [deviceInfo, setDeviceInfo] = useState("")

  // Refs for audio nodes
  const stateRef = useRef<{
    ctx: AudioContext | null
    stream: MediaStream | null
    osc: OscillatorNode | null
    oscGain: GainNode | null
    rawAnalysers: AnalyserNode[]
    toneAnalyser: AnalyserNode | null
    mixAnalyser: AnalyserNode | null
    raf: number | null
    stopped: boolean
  }>({
    ctx: null, stream: null, osc: null, oscGain: null,
    rawAnalysers: [], toneAnalyser: null, mixAnalyser: null,
    raf: null, stopped: false
  })

  const log = useCallback((msg: string) => {
    setStatus(prev => [`${new Date().toLocaleTimeString("da-DK", { hour12: false })}: ${msg}`, ...prev].slice(0, 20))
  }, [])

  const rms = (buf: Float32Array): number => {
    let s = 0
    for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i]
    return Math.min(100, Math.sqrt(s / buf.length) * 400)
  }

  useEffect(() => {
    navigator.mediaDevices.enumerateDevices().then(all => {
      const inputs = all.filter(d => d.kind === "audioinput")
      setDevices(inputs)
    })
  }, [])

  const startChain = async () => {
    const s = stateRef.current
    if (s.stopped === false && s.ctx) return // already running

    s.stopped = false
    setRunning(true)
    setRawLevels([0,0,0,0,0,0,0,0])
    setToneLevelMeter(0)
    setMixedLevel(0)
    setWebrtcLevel(0)

    log("Starting signal chain...")

    try {
      // 1. AudioContext
      const ctx = new AudioContext()
      await ctx.resume()
      s.ctx = ctx
      log(`AudioContext: ${ctx.state} @ ${ctx.sampleRate}Hz`)

      // 2. getUserMedia for physical device
      const constraints: MediaStreamConstraints = {
        audio: selectedDevice
          ? { deviceId: { exact: selectedDevice }, echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: { ideal: 8, min: 1 } }
          : { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
      }

      let stream: MediaStream | null = null
      try {
        stream = await navigator.mediaDevices.getUserMedia(constraints)
        s.stream = stream
        const track = stream.getAudioTracks()[0]
        const settings = track.getSettings()
        const info = `"${track.label}" – ${settings.channelCount ?? "?"} ch @ ${settings.sampleRate ?? "?"}Hz`
        setDeviceInfo(info)
        log(`✅ Stream: ${info}`)
      } catch (e: any) {
        log(`❌ getUserMedia: ${e.message}`)
        setRunning(false)
        return
      }

      const actualCh = Math.min(stream!.getAudioTracks()[0].getSettings().channelCount ?? 1, 8)

      // 3. Build raw input analysers (one per channel)
      const src = ctx.createMediaStreamSource(stream!)
      const rawAnalysers: AnalyserNode[] = []

      if (actualCh > 1) {
        const splitter = ctx.createChannelSplitter(actualCh)
        src.connect(splitter)
        for (let i = 0; i < 8; i++) {
          const a = ctx.createAnalyser(); a.fftSize = 2048; a.smoothingTimeConstant = 0.2
          if (i < actualCh) splitter.connect(a, i)
          rawAnalysers.push(a)
        }
        log(`Split into ${actualCh} channels`)
      } else {
        const a = ctx.createAnalyser(); a.fftSize = 2048; a.smoothingTimeConstant = 0.2
        src.connect(a)
        rawAnalysers.push(a)
        for (let i = 1; i < 8; i++) rawAnalysers.push(a) // same analyser for all
        log(`Mono device – all channels same`)
      }
      s.rawAnalysers = rawAnalysers

      // 4. Tone generator
      const osc = ctx.createOscillator()
      osc.type = "sine"; osc.frequency.value = toneFreq
      const oscGain = ctx.createGain()
      oscGain.gain.value = 0 // start silent
      const toneAnalyser = ctx.createAnalyser()
      toneAnalyser.fftSize = 2048; toneAnalyser.smoothingTimeConstant = 0.2
      osc.connect(oscGain); oscGain.connect(toneAnalyser); oscGain.connect(ctx.destination)
      osc.start()
      s.osc = osc; s.oscGain = oscGain; s.toneAnalyser = toneAnalyser
      log(`Tone generator ready (${toneFreq}Hz)`)

      // 5. Mix analyser – combines input + tone to show what WebRTC would send
      const merger = ctx.createChannelMerger(2)
      const mixAnalyser = ctx.createAnalyser()
      mixAnalyser.fftSize = 2048; mixAnalyser.smoothingTimeConstant = 0.2
      rawAnalysers[0].connect(merger, 0, 0)
      oscGain.connect(merger, 0, 1)
      merger.connect(mixAnalyser)
      s.mixAnalyser = mixAnalyser
      log(`Mix analyser ready`)

      // 6. Measurement loop
      const bufs = rawAnalysers.map(() => new Float32Array(2048))
      const toneBuf = new Float32Array(2048)
      const mixBuf = new Float32Array(2048)

      const tick = () => {
        if (s.stopped) return

        // Raw per-channel levels
        const newLevels = rawAnalysers.map((a, i) => {
          a.getFloatTimeDomainData(bufs[i]); return rms(bufs[i])
        })
        setRawLevels(newLevels)

        // Tone level
        toneAnalyser.getFloatTimeDomainData(toneBuf)
        setToneLevelMeter(rms(toneBuf))

        // Mix level
        mixAnalyser.getFloatTimeDomainData(mixBuf)
        setMixedLevel(rms(mixBuf))

        s.raf = requestAnimationFrame(tick)
      }
      s.raf = requestAnimationFrame(tick)
      log(`✅ Measurement running`)

    } catch (e: any) {
      log(`❌ Chain error: ${e.message}`)
      setRunning(false)
    }
  }

  const stopChain = () => {
    const s = stateRef.current
    s.stopped = true
    if (s.raf) cancelAnimationFrame(s.raf)
    s.osc?.stop()
    s.stream?.getTracks().forEach(t => t.stop())
    s.ctx?.close()
    stateRef.current = { ctx: null, stream: null, osc: null, oscGain: null, rawAnalysers: [], toneAnalyser: null, mixAnalyser: null, raf: null, stopped: true }
    setRunning(false)
    setToneActive(false)
    setRawLevels([0,0,0,0,0,0,0,0])
    setToneLevelMeter(0)
    setMixedLevel(0)
    setWebrtcLevel(0)
    log("Stopped")
  }

  const toggleTone = () => {
    const s = stateRef.current
    if (!s.oscGain || !s.ctx) { log("Start chain first"); return }
    if (toneActive) {
      s.oscGain.gain.setTargetAtTime(0, s.ctx.currentTime, 0.01)
      setToneActive(false)
      log("Tone OFF")
    } else {
      s.oscGain.gain.setTargetAtTime(toneLevel / 200, s.ctx.currentTime, 0.01)
      setToneActive(true)
      log(`Tone ON: ${toneFreq}Hz @ ${toneLevel}%`)
    }
  }

  const setFreq = (f: number) => {
    setToneFreq(f)
    const s = stateRef.current
    if (s.osc && s.ctx) s.osc.frequency.setTargetAtTime(f, s.ctx.currentTime, 0.01)
  }

  const setLevel = (l: number) => {
    setToneLevel(l)
    const s = stateRef.current
    if (toneActive && s.oscGain && s.ctx) s.oscGain.gain.setTargetAtTime(l / 200, s.ctx.currentTime, 0.01)
  }

  useEffect(() => () => stopChain(), [])

  const hasAnySignal = rawLevels.some(l => l > 2)
  const maxRaw = Math.max(...rawLevels)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80">
      <div className="w-[680px] max-h-[90vh] flex flex-col rounded-2xl overflow-hidden"
        style={{ background: "#0d0d0f", border: "1px solid rgba(255,255,255,0.1)" }}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-white/10">
          <div>
            <h2 className="font-black text-sm">Signal Chain Debugger</h2>
            <p className="text-[9px] text-white/30">Mål signal ved hvert punkt i kæden</p>
          </div>
          <button onClick={() => { stopChain(); onClose() }} className="text-white/30 hover:text-white"><X size={14} /></button>
        </div>

        <div className="flex-1 overflow-auto p-5 space-y-5">

          {/* Device + controls */}
          <div className="flex gap-2">
            <select value={selectedDevice} onChange={e => setSelectedDevice(e.target.value)}
              className="flex-1 bg-black border border-white/10 rounded-lg px-3 py-2 text-xs text-white">
              <option value="">Standard input</option>
              {devices.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label}</option>)}
            </select>
            <button onClick={running ? stopChain : startChain}
              className="px-4 py-2 rounded-lg text-xs font-bold flex items-center gap-2"
              style={running
                ? { background: "#ef4444", color: "white" }
                : { background: "#f97316", color: "white" }}>
              {running ? <><Square size={11} /> Stop</> : <><Play size={11} /> Start</>}
            </button>
          </div>

          {/* Device info */}
          {deviceInfo && (
            <div className="px-3 py-2 rounded-lg text-[10px] font-mono"
              style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.6)" }}>
              {deviceInfo}
            </div>
          )}

          {/* ====== SIGNAL CHAIN ====== */}
          <div className="space-y-4">

            {/* POINT 1: Raw from device */}
            <div className="rounded-xl p-4 space-y-3"
              style={{ background: hasAnySignal ? "rgba(34,197,94,0.06)" : "rgba(239,68,68,0.06)", border: `1px solid ${hasAnySignal ? "rgba(34,197,94,0.3)" : "rgba(239,68,68,0.2)"}` }}>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-black text-white flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-white/10 flex items-center justify-center text-[9px]">1</span>
                    RAW FRA LYDKORT
                  </p>
                  <p className="text-[9px] text-white/30 mt-0.5">getUserMedia → ChannelSplitter – her ser vi hvad browseren faktisk modtager</p>
                </div>
                {hasAnySignal
                  ? <span className="text-[9px] text-green-400 font-bold">✅ SIGNAL OK</span>
                  : <span className="text-[9px] text-red-400 font-bold">❌ INGEN LYD</span>
                }
              </div>
              <MultiChannelBar levels={rawLevels} label="" />
              {!hasAnySignal && running && (
                <div className="text-[9px] text-yellow-400 space-y-0.5 mt-1">
                  <p className="font-bold">Stream åbner men data er 0 – tjek i Apollo Console:</p>
                  <p>• Er der routing fra fysisk input til "<b>Virtual</b>" output?</p>
                  <p>• Er Monitor-kanalen aktiv (ikke muted)?</p>
                  <p>• Prøv: Apollo Console → "Monitor Mixer" → drag input til Aux/Virtual mix</p>
                  <p>• Alternativt: macOS Systemindstillinger → Lyd → Input → vælg Apollo og tjek level</p>
                </div>
              )}
            </div>

            {/* POINT 2: Tone generator */}
            <div className="rounded-xl p-4 space-y-3"
              style={{ background: "rgba(59,130,246,0.06)", border: "1px solid rgba(59,130,246,0.2)" }}>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-black text-white flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-white/10 flex items-center justify-center text-[9px]">2</span>
                    SOFTWARE TONE GENERATOR
                  </p>
                  <p className="text-[9px] text-white/30 mt-0.5">Genereret i browser – uafhængig af lydkort – bruges til at teste WebRTC-kæden</p>
                </div>
                <button onClick={toggleTone} disabled={!running}
                  className="px-3 py-1.5 rounded-lg text-[10px] font-bold"
                  style={toneActive
                    ? { background: "#ef4444", color: "white" }
                    : { background: "rgba(59,130,246,0.3)", border: "1px solid #3b82f6", color: "#3b82f6", opacity: running ? 1 : 0.4 }}>
                  {toneActive ? "Stop tone" : "Start tone"}
                </button>
              </div>

              {/* Tone controls */}
              <div className="flex gap-4 items-center">
                <div className="flex gap-1">
                  {[100,440,1000,5000].map(f => (
                    <button key={f} onClick={() => setFreq(f)}
                      className="px-2 py-1 text-[9px] rounded"
                      style={{ background: toneFreq === f ? "#3b82f630" : "rgba(255,255,255,0.05)", border: `1px solid ${toneFreq === f ? "#3b82f6" : "transparent"}`, color: toneFreq === f ? "#3b82f6" : "rgba(255,255,255,0.4)" }}>
                      {f >= 1000 ? `${f/1000}k` : f}Hz
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-2 flex-1">
                  <span className="text-[9px] text-white/30">Level</span>
                  <input type="range" min={0} max={100} value={toneLevel}
                    onChange={e => setLevel(Number(e.target.value))}
                    className="flex-1 h-1 appearance-none rounded bg-white/10 cursor-pointer" />
                  <span className="text-[9px] font-mono text-white/30 w-8">{toneLevel}%</span>
                </div>
              </div>

              <LevelBar level={toneLevel_meter} label="Tone output" sublabel="Målt efter gain" color="#3b82f6" />
            </div>

            {/* POINT 3: Mixed signal */}
            <div className="rounded-xl p-4 space-y-3"
              style={{ background: "rgba(249,115,22,0.06)", border: "1px solid rgba(249,115,22,0.2)" }}>
              <p className="text-xs font-black text-white flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-white/10 flex items-center justify-center text-[9px]">3</span>
                MIX (Lydkort + Tone)
              </p>
              <p className="text-[9px] text-white/30">Blanding af lydkort-input og tone – dette er hvad WebRTC ville sende</p>
              <LevelBar level={mixedLevel} label="Mix output" sublabel="Klar til WebRTC" color="#f97316" />

              {!hasAnySignal && toneActive && mixedLevel > 2 && (
                <div className="text-[9px] text-green-400 mt-1">
                  ✅ <b>Tonen kommer igennem!</b> WebRTC-kæden virker. Problemet er isoleret til lydkort-input (punkt 1).
                </div>
              )}
              {!hasAnySignal && !toneActive && running && (
                <p className="text-[9px] text-white/30 mt-1">Start tone (punkt 2) for at teste om WebRTC-kæden virker uafhængigt af lydkortet.</p>
              )}
            </div>

            {/* CONCLUSION */}
            {running && (
              <div className="rounded-xl p-4"
                style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}>
                <p className="text-[10px] font-bold text-white mb-2">Diagnose</p>
                <div className="space-y-1.5 text-[9px]">
                  <div className="flex items-start gap-2">
                    <span style={{ color: hasAnySignal ? "#22c55e" : "#ef4444" }}>{hasAnySignal ? "✅" : "❌"}</span>
                    <span className={hasAnySignal ? "text-green-300" : "text-white/50"}>
                      Lydkort sender signal til browser {hasAnySignal ? `(max ${maxRaw.toFixed(1)}%)` : "(0%)"}
                    </span>
                  </div>
                  <div className="flex items-start gap-2">
                    <span style={{ color: toneLevel_meter > 2 ? "#22c55e" : "#ef4444" }}>{toneLevel_meter > 2 ? "✅" : toneActive ? "❌" : "⬜"}</span>
                    <span className={toneLevel_meter > 2 ? "text-green-300" : "text-white/50"}>
                      Software tone generator {toneActive ? (toneLevel_meter > 2 ? "virker" : "fejl") : "ikke aktiveret"}
                    </span>
                  </div>
                  <div className="flex items-start gap-2">
                    <span style={{ color: mixedLevel > 2 ? "#22c55e" : "#ef4444" }}>{mixedLevel > 2 ? "✅" : "⬜"}</span>
                    <span className={mixedLevel > 2 ? "text-green-300" : "text-white/50"}>
                      Audio pipeline til WebRTC {mixedLevel > 2 ? "klar" : "ingen signal at sende"}
                    </span>
                  </div>

                  {!hasAnySignal && running && (
                    <div className="mt-3 p-2 rounded"
                      style={{ background: "rgba(234,179,8,0.1)", border: "1px solid rgba(234,179,8,0.3)" }}>
                      <p className="font-bold text-yellow-400 mb-1">Apollo 8P løsning:</p>
                      <p className="text-yellow-300/70">Stream åbner men er tom (2ch, 0% signal). I Apollo Console:</p>
                      <p className="text-yellow-300/70 mt-0.5">1. Åbn <b>Console 2</b> → vælg din session</p>
                      <p className="text-yellow-300/70">2. Find <b>"Record sends"</b> eller <b>"DAW sends"</b> kolonnen</p>
                      <p className="text-yellow-300/70">3. Aktiver routing fra Mic/Input preamp → til DAW channel 1-2</p>
                      <p className="text-yellow-300/70">4. Alternativt: Brug <b>Loopback</b> app til at route Apollo-output til en virtuel mikrofon</p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Log */}
          {status.length > 0 && (
            <div className="rounded-lg p-3 space-y-0.5" style={{ background: "rgba(0,0,0,0.4)", border: "1px solid rgba(255,255,255,0.06)" }}>
              {status.map((s, i) => (
                <p key={i} className="text-[9px] font-mono text-white/40">{s}</p>
              ))}
            </div>
          )}

        </div>
      </div>
    </div>
  )
}
