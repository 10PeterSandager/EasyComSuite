import React, { useState, useEffect, useRef } from "react"
import { Client } from "../types"
import { socket, initRouting, audioCtx, acquireConnection, releaseConnection } from "../client/webrtc/intercom"
import { produceStream, stopProducing, initMediasoup, isMediasoupReady, setClientId } from "../client/webrtc/mediasoupClient"
import { getBridgeStream, subscribeBridge, getBridgeChannelCount } from "../client/audio/audioBridgeStore"
import {
  Radio, Users, Mic, Lock, Plus, X, Check,
  ChevronDown, ChevronUp, Keyboard, Zap, Music
} from "lucide-react"

type TalkGroup = {
  id: string; name: string; members: string[]; color: string; keyTrigger?: string; tbChannel?: number
}

type Props = {
  client: Client; clients: Client[]
  onUpdate: (updates: Partial<Client>) => void
  theme?: "orange" | "blue"
}

const GROUP_COLORS = ["#ef4444","#f97316","#eab308","#22c55e","#06b6d4","#3b82f6","#a855f7","#ec4899"]

/* ============================================================
   LEVEL BAR COMPONENT
   ============================================================ */
function LevelBar({ level, label, color = "#22c55e" }: { level: number; label: string; color?: string }) {
  return (
    <div>
      <div className="flex justify-between mb-0.5">
        <span className="text-[8px] text-white/30">{label}</span>
        <span className="text-[8px] font-mono" style={{ color: level > 2 ? color : "rgba(255,255,255,0.2)" }}>
          {level.toFixed(0)}%
        </span>
      </div>
      <div className="h-3 bg-black rounded overflow-hidden">
        <div className="h-full rounded transition-all duration-75"
          style={{ width: `${Math.min(100, level)}%`, background: level > 85 ? "#ef4444" : level > 60 ? "#eab308" : color }} />
      </div>
    </div>
  )
}

const PRODUCER_ID = "producer-65"

export default function ProducerStrip({ client, clients, onUpdate, theme = "orange" }: Props) {

  /* ---- State ---- */
  const [expanded, setExpanded] = useState(true)
  const [allTalkLatched, setAllTalkLatched] = useState(false)
  const [allTalkPTT, setAllTalkPTT] = useState(false)
  const [talkGroups, setTalkGroups] = useState<TalkGroup[]>([])
  const [latchedGroups, setLatchedGroups] = useState<Set<string>>(new Set())
  const [pttGroups, setPttGroups] = useState<Set<string>>(new Set())
  const [micSource, setMicSource] = useState<"bridge" | "mic" | "tone" | null>(null)
  const [transportReady, setTransportReady] = useState(false)
  const [bridgeLevel, setBridgeLevel] = useState(0)
  const [bridgeActive, setBridgeActive] = useState(false)
  const [bridgeChannelCount, setBridgeChannelCount] = useState(0)
  const [selectedBridgeChannel, setSelectedBridgeChannel] = useState(1)
  const [allChannelLevels, setAllChannelLevels] = useState<number[]>([])
  const [showChannelPicker, setShowChannelPicker] = useState(false)

  /* ---- Tone generator state ---- */
  const [toneActive, setToneActive] = useState(false)
  const [toneFreq, setToneFreq] = useState(1000)
  const [toneLevel, setToneLevel] = useState(50)
  const [toneOutputLevel, setToneOutputLevel] = useState(0)
  const [showTone, setShowTone] = useState(false)

  /* ---- Group creation ---- */
  const [showCreate, setShowCreate] = useState(false)
  const [newName, setNewName] = useState("")
  const [newColor, setNewColor] = useState(GROUP_COLORS[0])
  const [newMembers, setNewMembers] = useState<string[]>([])
  const [newTbChannel, setNewTbChannel] = useState<number | undefined>(undefined)
  const [mappingGroupId, setMappingGroupId] = useState<string | null>(null)
  const [channelEditGroupId, setChannelEditGroupId] = useState<string | null>(null)
  const [baseTbChannel, setBaseTbChannel] = useState<number>(() => {
    try { return parseInt(localStorage.getItem("easycom:baseTbChannel") ?? "1") || 1 } catch { return 1 }
  })
  const [editingName, setEditingName] = useState(false)
  const [tempName, setTempName] = useState(client.name)

  /* ---- Refs ---- */
  const hasProducedRef = useRef(false)
  const isProducingRef = useRef(false)
  const startMicRef = useRef<() => Promise<void>>()
  const micStreamRef = useRef<MediaStream | null>(null)
  const toneCtxRef = useRef<AudioContext | null>(null)
  const toneOscRef = useRef<OscillatorNode | null>(null)
  const toneGainRef = useRef<GainNode | null>(null)
  const toneDestRef = useRef<MediaStreamAudioDestinationNode | null>(null)
  const toneAnalyserRef = useRef<AnalyserNode | null>(null)
  const toneRafRef = useRef<number | null>(null)
  const stopMicTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const accentColor = theme === "orange" ? "#f97316" : "#3b82f6"
  const otherClients = clients.filter(c => c.id !== client.id && !c.hidden && c.status === 'online')
  const isAllActive = allTalkPTT || allTalkLatched
  const isTalking = isAllActive || latchedGroups.size > 0 || pttGroups.size > 0

  useEffect(() => {
    const activeChannels: number[] = []
    if (isAllActive) activeChannels.push(baseTbChannel)
    for (const gId of [...pttGroups, ...latchedGroups]) {
      const g = talkGroups.find(x => x.id === gId)
      if (g?.tbChannel && !activeChannels.includes(g.tbChannel)) activeChannels.push(g.tbChannel)
    }
    socket.emit("host:producer:channels", { producerId: PRODUCER_ID, channels: activeChannels })
  }, [isAllActive, baseTbChannel, pttGroups, latchedGroups, talkGroups])

  useEffect(() => {
    try { localStorage.setItem("easycom:baseTbChannel", String(baseTbChannel)) } catch {}
  }, [baseTbChannel])

  /* ---- Init ---- */
  useEffect(() => {
    return subscribeBridge(s => {
      const channels = s.channels || []
      const activeCh = channels.filter(c => c.status === "active")
      setBridgeChannelCount(activeCh.length)
      setBridgeActive(activeCh.length > 0)
      setAllChannelLevels(channels.map(c => c.level || 0))
      // Opdater niveau for valgt kanal
      const selCh = channels.find(c => c.channel === selectedBridgeChannel)
      setBridgeLevel(selCh?.level ?? (activeCh[0]?.level ?? 0))
    })
  }, [])

  useEffect(() => {
    setClientId(PRODUCER_ID)
    const init = async () => {
      try {
        await initMediasoup()
        initRouting(PRODUCER_ID)
        setTransportReady(true)
      } catch (e) {
        console.error("ProducerStrip: mediasoup init failed:", e)
        setTimeout(init, 2000)
      }
    }
    if (!isMediasoupReady()) init()
    else { initRouting(PRODUCER_ID); setTransportReady(true) }
  }, [])

  // Expose startMic globally so ClientStrip Talk buttons can trigger it
  useEffect(() => {
    startMicRef.current = startMic
  })
  useEffect(() => {
    ;(window as any).__easycomStartMic = () => startMicRef.current?.()
    ;(window as any).__easycomStopMicFully = () => stopMicFully()
    return () => { delete (window as any).__easycomStartMic; delete (window as any).__easycomStopMicFully }
  }, [])

  /* ============================================================
     TONE GENERATOR
     ============================================================ */
  const startTone = async () => {
    if (toneActive) return
    if (!isMediasoupReady()) await initMediasoup()
    audioCtx.resume().catch(() => {})

    try {
      const ctx = new AudioContext()
      await ctx.resume()
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 1024
      const dest = ctx.createMediaStreamDestination()

      osc.type = "sine"
      osc.frequency.value = toneFreq
      gain.gain.value = toneLevel / 200

      osc.connect(gain)
      gain.connect(analyser)
      gain.connect(dest)
      // Also connect to speakers so producer can hear it locally
      gain.connect(ctx.destination)
      osc.start()

      toneCtxRef.current = ctx
      toneOscRef.current = osc
      toneGainRef.current = gain
      toneDestRef.current = dest
      toneAnalyserRef.current = analyser

      // Level meter lokalt + send til server
      const buf = new Float32Array(analyser.fftSize)
      const tick = () => {
        analyser.getFloatTimeDomainData(buf)
        let s = 0; for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i]
        const level = Math.min(100, Math.sqrt(s / buf.length) * 400)
        setToneOutputLevel(level)
        // 🔥 Send niveau til server så clients kan se det i meterne
        socket.emit("audio:level", { clientId: PRODUCER_ID, level })
        toneRafRef.current = requestAnimationFrame(tick)
      }
      toneRafRef.current = requestAnimationFrame(tick)

      // Produce tone stream
      await produceStream(dest.stream)
      hasProducedRef.current = true
      isProducingRef.current = true
      setToneActive(true)
      setMicSource("tone")
      console.log("🎵 ProducerStrip: tone producing at", toneFreq, "Hz")

    } catch (e: any) {
      console.error("startTone error:", e)
    }
  }

  const stopTone = async () => {
    if (toneRafRef.current) cancelAnimationFrame(toneRafRef.current)
    try { toneOscRef.current?.stop() } catch {}
    toneCtxRef.current?.close()
    toneCtxRef.current = null
    toneOscRef.current = null
    toneGainRef.current = null
    toneDestRef.current = null
    toneAnalyserRef.current = null
    setToneOutputLevel(0)
    setToneActive(false)
    // 🔥 Send level=0 så meters falder til nul
    socket.emit("audio:level", { clientId: PRODUCER_ID, level: 0 })

    // Stop WebRTC producer
    await stopProducing().catch(() => {})
    hasProducedRef.current = false
    isProducingRef.current = false
    setMicSource(null)
  }

  const updateToneFreq = (f: number) => {
    setToneFreq(f)
    if (toneOscRef.current && toneCtxRef.current) {
      toneOscRef.current.frequency.setTargetAtTime(f, toneCtxRef.current.currentTime, 0.01)
    }
  }

  const updateToneLevel = (l: number) => {
    setToneLevel(l)
    if (toneGainRef.current && toneCtxRef.current) {
      toneGainRef.current.gain.setTargetAtTime(l / 200, toneCtxRef.current.currentTime, 0.01)
    }
  }

  /* ============================================================
     MIC / BRIDGE
     ============================================================ */
  const startMic = async () => {
    if (stopMicTimerRef.current) { clearTimeout(stopMicTimerRef.current); stopMicTimerRef.current = null }
    if (toneActive) { console.warn("Tone is active – stop it first"); return }
    if (hasProducedRef.current) { setMicSource(prev => prev ?? "bridge"); return }
    if (!isMediasoupReady()) await initMediasoup()
    audioCtx.resume().catch(() => {})

    try {
      const bridgeStream = getBridgeStream(selectedBridgeChannel)
      if (bridgeStream && bridgeStream.getAudioTracks().length > 0) {
        await produceStream(bridgeStream)
        hasProducedRef.current = true
        isProducingRef.current = true
        setMicSource("bridge")

        // 🔥 Send audio:level events for bridge stream – ligesom tone-generatoren
        const bridgeCtx = new AudioContext()
        await bridgeCtx.resume()
        const bridgeSrc = bridgeCtx.createMediaStreamSource(bridgeStream)
        const bridgeAnalyser = bridgeCtx.createAnalyser()
        bridgeAnalyser.fftSize = 1024
        bridgeSrc.connect(bridgeAnalyser)
        const bridgeBuf = new Float32Array(bridgeAnalyser.fftSize)
        const bridgeTick = () => {
          if (!isProducingRef.current) {
            socket.emit("audio:level", { clientId: PRODUCER_ID, level: 0 })
            bridgeCtx.close()
            return
          }
          bridgeAnalyser.getFloatTimeDomainData(bridgeBuf)
          let s = 0; for (let i = 0; i < bridgeBuf.length; i++) s += bridgeBuf[i] * bridgeBuf[i]
          const level = Math.min(100, Math.sqrt(s / bridgeBuf.length) * 400)
          socket.emit("audio:level", { clientId: PRODUCER_ID, level })
          toneRafRef.current = requestAnimationFrame(bridgeTick)
        }
        toneRafRef.current = requestAnimationFrame(bridgeTick)
        return
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
      })
      micStreamRef.current = stream
      await produceStream(stream)
      hasProducedRef.current = true
      isProducingRef.current = true
      setMicSource("mic")
    } catch (e: any) {
      console.error("startMic:", e)
      hasProducedRef.current = false; isProducingRef.current = false; setMicSource(null)
    }
  }

  const stopMicFully = async () => {
    if (!isProducingRef.current) return
    micStreamRef.current?.getTracks().forEach(t => t.stop())
    micStreamRef.current = null
    await stopProducing().catch(() => {})
    hasProducedRef.current = false; isProducingRef.current = false; setMicSource(null)
  }

  // Debounced stop — waits 2s before actually stopping so rapid PTT
  // presses don't cycle the producer and inflate the phone's jitter buffer.
  const stopMicSoon = () => {
    if (stopMicTimerRef.current) clearTimeout(stopMicTimerRef.current)
    stopMicTimerRef.current = setTimeout(() => {
      stopMicTimerRef.current = null
      stopMicFully()
    }, 2000)
  }

  /* ---- Connections ---- */
  const createConn = (toId: string) => acquireConnection(PRODUCER_ID, toId, 1)
  const removeConn = (toId: string) => releaseConnection(PRODUCER_ID, toId, 1)

  /* ---- Talk All ---- */
  const startAllTalk = async () => {
    await startMic()
    setAllTalkPTT(true)
    otherClients.forEach(c => createConn(c.id))
  }
  const stopAllTalk = async () => {
    setAllTalkPTT(false)
    if (!allTalkLatched) {
      otherClients.forEach(c => removeConn(c.id))
      if (latchedGroups.size === 0) stopMicSoon()
    }
  }
  const toggleAllLatch = async () => {
    if (allTalkLatched) {
      setAllTalkLatched(false); setAllTalkPTT(false)
      otherClients.forEach(c => removeConn(c.id))
      if (latchedGroups.size === 0) stopMicSoon()
    } else {
      await startMic()
      setAllTalkLatched(true); setAllTalkPTT(true)
      otherClients.forEach(c => createConn(c.id))
    }
  }

  /* ---- Groups ---- */
  const startGroupPTT = async (g: TalkGroup) => {
    await startMic()
    setPttGroups(prev => new Set([...prev, g.id]))
    g.members.forEach(id => createConn(id))
  }
  const stopGroupPTT = async (g: TalkGroup) => {
    setPttGroups(prev => { const s = new Set(prev); s.delete(g.id); return s })
    if (!latchedGroups.has(g.id)) {
      g.members.forEach(id => {
        if (!isAllActive && !talkGroups.filter(x => x.id !== g.id).some(x => latchedGroups.has(x.id) && x.members.includes(id)))
          removeConn(id)
      })
      if (!isAllActive && latchedGroups.size === 0 && pttGroups.size <= 1) stopMicSoon()
    }
  }
  const toggleGroupLatch = async (g: TalkGroup) => {
    const isLatched = latchedGroups.has(g.id)
    if (isLatched) {
      setLatchedGroups(prev => { const s = new Set(prev); s.delete(g.id); return s })
      setPttGroups(prev => { const s = new Set(prev); s.delete(g.id); return s })
      g.members.forEach(id => {
        if (!isAllActive && !talkGroups.filter(x => x.id !== g.id).some(x => latchedGroups.has(x.id) && x.members.includes(id)))
          removeConn(id)
      })
      if (!isAllActive && latchedGroups.size <= 1) stopMicSoon()
    } else {
      await startMic()
      setLatchedGroups(prev => new Set([...prev, g.id]))
      setPttGroups(prev => new Set([...prev, g.id]))
      g.members.forEach(id => createConn(id))
    }
  }
  const deleteGroup = (id: string) => {
    const g = talkGroups.find(x => x.id === id)
    if (g && latchedGroups.has(id)) g.members.forEach(mid => removeConn(mid))
    setTalkGroups(prev => prev.filter(x => x.id !== id))
    setLatchedGroups(prev => { const s = new Set(prev); s.delete(id); return s })
    setPttGroups(prev => { const s = new Set(prev); s.delete(id); return s })
  }
  const createGroup = () => {
    if (!newName.trim() || newMembers.length === 0) return
    setTalkGroups(prev => [...prev, { id: crypto.randomUUID(), name: newName.trim(), members: newMembers, color: newColor, tbChannel: newTbChannel }])
    setNewName(""); setNewMembers([]); setNewColor(GROUP_COLORS[0]); setNewTbChannel(undefined); setShowCreate(false)
  }

  /* ---- Keyboard ---- */
  useEffect(() => {
    if (!mappingGroupId) return
    const h = (e: KeyboardEvent) => {
      e.preventDefault()
      setTalkGroups(prev => prev.map(g => g.id === mappingGroupId ? { ...g, keyTrigger: e.code } : g))
      setMappingGroupId(null)
    }
    window.addEventListener("keydown", h, true)
    return () => window.removeEventListener("keydown", h, true)
  }, [mappingGroupId])

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const g = talkGroups.find(x => x.keyTrigger === e.code)
      if (g && !pttGroups.has(g.id)) startGroupPTT(g)
    }
    const up = (e: KeyboardEvent) => {
      const g = talkGroups.find(x => x.keyTrigger === e.code)
      if (g) stopGroupPTT(g)
    }
    window.addEventListener("keydown", down); window.addEventListener("keyup", up)
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up) }
  }, [talkGroups, pttGroups, latchedGroups, isAllActive])

  /* ============================================================
     RENDER
     ============================================================ */
  return (
    <div className="rounded-2xl overflow-hidden mb-4 w-full"
      style={{ background: "linear-gradient(135deg,#1a1a1a,#111)", border: `1px solid ${accentColor}30` }}>

      {/* HEADER */}
      <div className="flex items-center justify-between px-5 py-3"
        style={{ background: `linear-gradient(90deg,${accentColor}20,transparent)`, borderBottom: `1px solid ${accentColor}15` }}>
        <div className="flex items-center gap-3 flex-1">
          <div className="w-3 h-3 rounded-full shrink-0"
            style={{ background: transportReady ? accentColor : "#555", boxShadow: transportReady ? `0 0 8px ${accentColor}` : "none" }} />
          <div className="flex-1 min-w-0">
            <span className="text-[9px] font-mono text-white/30 uppercase tracking-widest">CL 65</span>
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              {editingName ? (
                <input autoFocus value={tempName} onChange={e => setTempName(e.target.value)}
                  onBlur={() => { if (tempName.trim()) onUpdate({ name: tempName.trim() }); setEditingName(false) }}
                  onKeyDown={e => { if (e.key === "Enter") { if (tempName.trim()) onUpdate({ name: tempName.trim() }); setEditingName(false) } }}
                  className="text-sm font-black bg-black/50 border border-white/20 rounded px-2 py-0.5 text-white w-40" />
              ) : (
                <span className="text-sm font-black text-white cursor-pointer"
                  onDoubleClick={e => { e.stopPropagation(); setTempName(client.name); setEditingName(true) }}>
                  {client.name}
                </span>
              )}
              {!transportReady && <span className="text-[9px] text-white/30">Initializing...</span>}
              {isAllActive && <span className="text-[9px] px-2 py-0.5 rounded-full font-bold animate-pulse" style={{ background: accentColor + "30", color: accentColor }}>TALK ALL</span>}
              {micSource === "bridge" && isTalking && <span className="text-[9px] px-1.5 py-0.5 rounded font-bold" style={{ background: "#22c55e20", color: "#22c55e" }}>🎛️ SOUNDCARD</span>}
              {micSource === "mic" && isTalking && <span className="text-[9px] px-1.5 py-0.5 rounded font-bold" style={{ background: "#3b82f620", color: "#3b82f6" }}>🎤 MIC</span>}
              {micSource === "tone" && <span className="text-[9px] px-1.5 py-0.5 rounded font-bold animate-pulse" style={{ background: "#a855f720", color: "#a855f7" }}>🎵 TONE</span>}
            </div>
          </div>
        </div>
        <button onClick={() => setExpanded(p => !p)} className="text-white/30 hover:text-white ml-2">
          {expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
        </button>
      </div>

      {expanded && (
        <div className="px-5 py-4 space-y-4">

          {/* ============ MAIN ROW ============ */}
          <div className="flex gap-6 flex-wrap items-start">

            {/* TALK ALL + METERS */}
            <div className="flex flex-col gap-2 shrink-0 w-48">
              <div className="flex items-center justify-between">
                <span className="text-[8px] uppercase tracking-widest text-white/30 font-bold">Talk All</span>
                <div className="flex items-center gap-1">
                  <span className="text-[7px] text-white/20">CH 65 TB:</span>
                  <input type="number" min={1} max={16}
                    value={baseTbChannel}
                    onChange={e => setBaseTbChannel(parseInt(e.target.value) || 1)}
                    className="w-9 px-1 py-0.5 bg-black border border-white/10 rounded text-[9px] text-white text-center font-mono" />
                </div>
              </div>
              <div className="flex gap-1.5">
                <button
                  onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); startAllTalk() }}
                  onPointerUp={e => { e.currentTarget.releasePointerCapture(e.pointerId); stopAllTalk() }}
                  onPointerCancel={e => { e.currentTarget.releasePointerCapture(e.pointerId); stopAllTalk() }}
                  disabled={!transportReady || toneActive}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-xl font-black text-xs uppercase tracking-widest transition-all touch-none disabled:opacity-40"
                  style={isAllActive
                    ? { background: accentColor, color: "white", boxShadow: `0 0 16px ${accentColor}60` }
                    : { background: accentColor + "15", border: `1px solid ${accentColor}40`, color: accentColor }}>
                  <Radio size={13} /> TALK ALL
                </button>
                <button onClick={toggleAllLatch} disabled={!transportReady || toneActive}
                  className="px-3 py-2.5 rounded-xl transition-all disabled:opacity-40"
                  style={allTalkLatched
                    ? { background: accentColor, color: "white" }
                    : { background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.4)" }}>
                  <Lock size={13} />
                </button>
              </div>

              {/* INPUT METERS */}
              <div className="space-y-1.5 mt-1">
                {bridgeActive && (
                  <div className="relative">
                    <div className="flex items-center gap-1.5">
                      <LevelBar level={bridgeLevel} label={`🎛️ CH${selectedBridgeChannel}`} color="#22c55e" />
                      {bridgeChannelCount > 1 && (
                        <button
                          onClick={() => setShowChannelPicker(p => !p)}
                          className="shrink-0 px-2 py-0.5 rounded text-[8px] font-bold"
                          style={{ background: showChannelPicker ? "#22c55e30" : "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", color: "rgba(255,255,255,0.5)" }}>
                          ▼
                        </button>
                      )}
                    </div>
                    {showChannelPicker && bridgeChannelCount > 1 && (
                      <div className="mt-1 rounded-xl p-2 space-y-1 w-44"
                        style={{ background: "#1a1a1a", border: "1px solid rgba(255,255,255,0.12)" }}>
                        <p className="text-[8px] text-white/30 uppercase tracking-widest px-1 pb-1">Select channel</p>
                        {Array.from({ length: bridgeChannelCount }, (_, i) => i + 1).map(ch => (
                          <button key={ch}
                            onClick={() => {
                              setSelectedBridgeChannel(ch)
                              setShowChannelPicker(false)
                            }}
                            className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left"
                            style={selectedBridgeChannel === ch
                              ? { background: "#22c55e20", border: "1px solid #22c55e40", color: "#22c55e" }
                              : { background: "transparent", color: "rgba(255,255,255,0.5)" }}>
                            <span className="text-[9px] font-mono text-white/25 w-5">CH{ch}</span>
                            <div className="flex-1 h-1.5 bg-black rounded overflow-hidden">
                              <div className="h-full rounded"
                                style={{ width: `${Math.min(100, allChannelLevels[ch-1] || 0)}%`, background: "#22c55e" }} />
                            </div>
                            <span className="text-[8px] font-mono" style={{ color: "#22c55e80" }}>
                              {(allChannelLevels[ch-1] || 0).toFixed(0)}%
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                {toneActive && (
                  <LevelBar level={toneOutputLevel} label="🎵 Tone out" color="#a855f7" />
                )}
                {!bridgeActive && !toneActive && (
                  <p className="text-[8px] text-white/20">No active source</p>
                )}
              </div>
            </div>

            <div className="w-px self-stretch bg-white/5 shrink-0" />

            {/* GROUPS */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[8px] uppercase tracking-widest text-white/30 font-bold flex items-center gap-1.5">
                  <Users size={10} /> GROUPS
                </span>
                <button onClick={() => setShowCreate(p => !p)}
                  className="flex items-center gap-1 px-2 py-1 rounded-lg text-[9px] font-bold"
                  style={{ background: accentColor + "20", color: accentColor, border: `1px solid ${accentColor}40` }}>
                  <Plus size={10} /> New group
                </button>
              </div>

              {showCreate && (
                <div className="rounded-xl p-3 mb-3 space-y-2.5"
                  style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
                  <input autoFocus value={newName} onChange={e => setNewName(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && createGroup()}
                    placeholder="Group name..."
                    className="w-full px-2.5 py-1.5 bg-black border border-white/10 rounded-lg text-xs text-white" />
                  <div className="flex gap-1.5 flex-wrap">
                    {GROUP_COLORS.map(c => (
                      <button key={c} onClick={() => setNewColor(c)}
                        className="w-5 h-5 rounded-full border-2 hover:scale-110 transition-transform"
                        style={{ background: c, borderColor: newColor === c ? "white" : "transparent" }} />
                    ))}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[9px] text-white/40 shrink-0">CH 65 TB:</span>
                    <input type="number" min={1} max={16} placeholder="—"
                      value={newTbChannel ?? ""}
                      onChange={e => setNewTbChannel(e.target.value ? parseInt(e.target.value) : undefined)}
                      className="w-12 px-1.5 py-1 bg-black border border-white/10 rounded text-xs text-white text-center" />
                    <span className="text-[9px] text-white/20">activates on talk</span>
                  </div>
                  <div className="flex gap-1.5 flex-wrap max-h-24 overflow-auto">
                    {otherClients.map(c => (
                      <button key={c.id}
                        onClick={() => setNewMembers(prev => prev.includes(c.id) ? prev.filter(x => x !== c.id) : [...prev, c.id])}
                        className="flex items-center gap-1 px-2 py-1 rounded-lg text-[9px] font-bold"
                        style={newMembers.includes(c.id)
                          ? { background: newColor + "30", border: `1px solid ${newColor}`, color: "white" }
                          : { background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.4)" }}>
                        {c.color && <span className="w-1.5 h-1.5 rounded-full" style={{ background: c.color }} />}
                        {c.name}
                        {newMembers.includes(c.id) && <Check size={8} style={{ color: newColor }} />}
                      </button>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => { setShowCreate(false); setNewName(""); setNewMembers([]) }}
                      className="flex-1 py-1.5 rounded-lg text-[9px] bg-white/5 text-white/40">Cancel</button>
                    <button onClick={createGroup} disabled={!newName.trim() || newMembers.length === 0}
                      className="flex-1 py-1.5 rounded-lg text-[9px] font-bold"
                      style={{ background: newName.trim() && newMembers.length > 0 ? accentColor : "rgba(255,255,255,0.08)", color: "white" }}>
                      Save ({newMembers.length})
                    </button>
                  </div>
                </div>
              )}

              {talkGroups.length === 0 && !showCreate && (
                <p className="text-[9px] text-white/20 italic">No groups created yet</p>
              )}

              <div className="flex gap-2 flex-wrap">
                {talkGroups.map(group => {
                  const isLatched = latchedGroups.has(group.id)
                  const isActive = isLatched || pttGroups.has(group.id)
                  const isMappingThis = mappingGroupId === group.id
                  const isEditingChannel = channelEditGroupId === group.id
                  return (
                    <div key={group.id} className="flex flex-col gap-1">
                      {group.keyTrigger && (
                        <div className="flex items-center gap-1 px-2 py-0.5 rounded"
                          style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}>
                          <span className="text-[7px] text-white/30 font-mono flex-1">{group.keyTrigger}</span>
                          <button onClick={() => setTalkGroups(prev => prev.map(g => g.id === group.id ? { ...g, keyTrigger: undefined } : g))}
                            className="text-white/20 hover:text-red-400"><X size={7} /></button>
                        </div>
                      )}
                      {isEditingChannel && (
                        <div className="flex items-center gap-1 px-1.5 py-0.5 rounded"
                          style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)" }}>
                          <span className="text-[7px] text-white/30 shrink-0">CH 65 TB:</span>
                          <input autoFocus type="number" min={1} max={16}
                            defaultValue={group.tbChannel ?? ""}
                            onBlur={e => { setTalkGroups(prev => prev.map(g => g.id === group.id ? { ...g, tbChannel: e.target.value ? parseInt(e.target.value) : undefined } : g)); setChannelEditGroupId(null) }}
                            onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur() }}
                            className="w-10 bg-black border border-white/10 rounded px-1 text-[9px] text-white text-center" />
                        </div>
                      )}
                      <div className="flex gap-1">
                        <button
                          onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); startGroupPTT(group) }}
                          onPointerUp={e => { e.currentTarget.releasePointerCapture(e.pointerId); stopGroupPTT(group) }}
                          onPointerCancel={e => { e.currentTarget.releasePointerCapture(e.pointerId); stopGroupPTT(group) }}
                          disabled={!transportReady || toneActive}
                          className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-[10px] font-bold select-none touch-none disabled:opacity-40"
                          style={isActive
                            ? { background: group.color + "30", border: `1px solid ${group.color}`, color: group.color }
                            : { background: group.color + "15", border: `1px solid ${group.color}40`, borderLeft: `3px solid ${group.color}`, color: group.color }}>
                          <Mic size={11} /> {group.name} <span className="opacity-50 text-[8px]">{group.members.length}</span>
                          {group.tbChannel && <span className="text-[7px] opacity-60 font-mono">ch{group.tbChannel}</span>}
                        </button>
                        <button onClick={() => toggleGroupLatch(group)} className="px-2 py-2 rounded-xl"
                          style={isLatched ? { background: group.color, color: "white" } : { background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.3)" }}>
                          <Lock size={11} />
                        </button>
                        <button onClick={() => setMappingGroupId(isMappingThis ? null : group.id)} className="px-2 py-2 rounded-xl"
                          style={isMappingThis ? { background: accentColor, color: "white" }
                            : group.keyTrigger ? { background: "rgba(34,197,94,0.15)", border: "1px solid rgba(34,197,94,0.3)", color: "#22c55e" }
                              : { background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.3)" }}>
                          <Keyboard size={11} />
                        </button>
                        <button onClick={() => setChannelEditGroupId(isEditingChannel ? null : group.id)}
                          className="px-2 py-2 rounded-xl text-[8px] font-mono font-bold"
                          style={isEditingChannel ? { background: accentColor, color: "white" }
                            : group.tbChannel ? { background: "rgba(168,85,247,0.15)", border: "1px solid rgba(168,85,247,0.3)", color: "#a855f7" }
                              : { background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.3)" }}>
                          {group.tbChannel ?? "—"}
                        </button>
                        <button onClick={() => deleteGroup(group.id)}
                          className="px-1.5 py-2 rounded-xl hover:bg-red-600/20 text-white/15 hover:text-red-400">
                          <X size={10} />
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>

          {/* ============ TONE GENERATOR ============ */}
          <div className="rounded-xl overflow-hidden"
            style={{ border: `1px solid ${toneActive ? "#a855f640" : "rgba(255,255,255,0.08)"}`, background: toneActive ? "rgba(168,85,247,0.05)" : "rgba(255,255,255,0.02)" }}>

            <button onClick={() => setShowTone(p => !p)}
              className="w-full flex items-center justify-between px-3 py-2">
              <div className="flex items-center gap-2">
                <Music size={11} className={toneActive ? "text-purple-400" : "text-white/30"} />
                <span className="text-[9px] font-bold uppercase tracking-widest text-white/50">Tone Generator</span>
              </div>
              <div className="flex items-center gap-2">
                {toneActive && <span className="text-[8px] px-1.5 py-0.5 rounded font-bold animate-pulse" style={{ background: "#a855f720", color: "#a855f7" }}>ACTIVE</span>}
                <span className="text-white/20 text-xs">{showTone ? "▲" : "▼"}</span>
              </div>
            </button>

            {showTone && (
              <div className="px-3 pb-3 space-y-3" style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}>


                {/* Freq presets */}
                <div className="flex gap-1 flex-wrap">
                  {[100, 440, 1000, 5000].map(f => (
                    <button key={f} onClick={() => updateToneFreq(f)}
                      className="px-2 py-1 rounded text-[9px]"
                      style={{
                        background: toneFreq === f ? "#a855f720" : "rgba(255,255,255,0.05)",
                        border: `1px solid ${toneFreq === f ? "#a855f7" : "transparent"}`,
                        color: toneFreq === f ? "#a855f7" : "rgba(255,255,255,0.4)"
                      }}>
                      {f >= 1000 ? `${f / 1000}k` : f}Hz
                    </button>
                  ))}
                  <div className="flex items-center gap-1.5 ml-1 flex-1">
                    <span className="text-[8px] text-white/30 shrink-0">Level</span>
                    <input type="range" min={0} max={100} value={toneLevel}
                      onChange={e => updateToneLevel(Number(e.target.value))}
                      className="flex-1 h-1 rounded cursor-pointer appearance-none"
                      style={{ background: "rgba(255,255,255,0.1)" }} />
                    <span className="text-[8px] font-mono text-white/30 w-7">{toneLevel}%</span>
                  </div>
                </div>

                {/* Level meter */}
                {toneActive && <LevelBar level={toneOutputLevel} label="Output level" color="#a855f7" />}

                {/* Start/stop */}
                <div className="flex gap-2">
                  <button onClick={toneActive ? stopTone : startTone}
                    disabled={!transportReady || (isTalking && !toneActive)}
                    className="flex-1 py-2.5 rounded-xl font-black text-xs uppercase tracking-widest"
                    style={toneActive
                      ? { background: "#ef4444", color: "white" }
                      : { background: "#a855f7", color: "white", opacity: transportReady ? 1 : 0.4 }}>
                    {toneActive ? "■ Stop tone" : "▶ Start tone"}
                  </button>

                  {/* Quick: tone + talk all */}
                  {toneActive && !isAllActive && (
                    <button onClick={async () => {
                      setAllTalkLatched(true); setAllTalkPTT(true)
                      otherClients.forEach(c => createConn(c.id))
                    }}
                      className="flex-1 py-2.5 rounded-xl font-black text-xs uppercase tracking-widest"
                      style={{ background: accentColor, color: "white" }}>
                      + Latch Talk All
                    </button>
                  )}
                </div>

                {toneActive && isAllActive && (
                  <p className="text-[9px] text-center text-purple-300/70">
                    ✅ Tone sending to all connected clients — can they hear it?
                  </p>
                )}
              </div>
            )}
          </div>

        </div>
      )}

      {mappingGroupId && (
        <div className="px-5 py-2 text-[10px] text-center animate-pulse"
          style={{ background: accentColor + "20", color: accentColor }}>
          🎹 Press a key for "{talkGroups.find(g => g.id === mappingGroupId)?.name}"
          <button onClick={() => setMappingGroupId(null)} className="ml-2 text-white/40 hover:text-white">✕</button>
        </div>
      )}
    </div>
  )
}
