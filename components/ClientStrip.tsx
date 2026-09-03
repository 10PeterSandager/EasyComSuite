import React, { useState, useEffect, useRef } from 'react'
import { Client } from '../types'
import { subscribeToLevels, socket, startFeedMonitor, stopFeedMonitor, setFeedMonitorVolume, getClientMonitorStream, acquireConnection, releaseConnection } from '../client/webrtc/intercom'
import { getChannelStream } from '../client/audio/AudioBridge'
import IFBPanel, { IFBSettings } from './IFBPanel'
import { Mic, Volume2, VolumeX, Smartphone, Monitor, Tablet, UserX, Keyboard, Video, SlidersHorizontal, Headphones, Lock, Radio, Gauge } from 'lucide-react'

export type FeedSource = { id: string; label: string }

type Props = {
  client: Client
  isSelected: boolean
  onUpdate: (updates: Partial<Client>) => void
  theme: 'orange' | 'blue'
  onHijack?: () => void
  onMapKey?: () => void
  isMixerOpen?: boolean
  onToggleMixer?: () => void
  feedSources?: FeedSource[]
  allClients?: Client[]
  roles?: { id: string; label: string; color: string }[]
  tallyState?: 'program' | 'preview' | 'off'
  onTallySet?: (state: 'program' | 'preview' | 'off') => void
  onBaseGainChange?: (gain: number) => void
}

const defaultIFB = (): IFBSettings => ({ active: false, channels: {} })
const MAX_CH = 16
const chColors = ["#ef4444","#3b82f6","#22c55e","#a855f7","#f97316","#06b6d4","#eab308","#ec4899","#84cc16","#0ea5e9","#f43f5e","#8b5cf6","#10b981","#fb923c","#a78bfa","#34d399"]

function Bar({ level, color }: { level: number; color: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column-reverse", gap: 1, width: 5, height: 28 }}>
      {Array.from({ length: 8 }, (_, i) => {
        const t = (i + 1) / 8; const on = level / 100 >= t
        return <div key={i} style={{ flex: 1, borderRadius: 1, background: on ? t > 0.85 ? "#ef4444" : t > 0.6 ? "#eab308" : color : "rgba(255,255,255,0.07)" }} />
      })}
    </div>
  )
}

// Stop events from bubbling to parent drag handlers
const stopDrag = (e: React.SyntheticEvent) => {
  e.stopPropagation()
  e.nativeEvent?.stopImmediatePropagation?.()
}

const ClientStrip: React.FC<Props> = ({
  client, isSelected, onUpdate, theme,
  onHijack = () => {}, onMapKey = () => {},
  isMixerOpen = false, onToggleMixer = () => {},
  feedSources = [], allClients = [], roles = [],
  tallyState = 'off', onTallySet, onBaseGainChange
}) => {

  const [snd, setSnd] = useState(0)
  const [rcv, setRcv] = useState(0)
  const [showGain, setShowGain] = useState(false)
  const [baseGain, setBaseGain] = useState(100)
  const [phoneRoutes, setPhoneRoutes] = useState<Array<{ from: string; name: string }>>([])
  const [disabledPhoneIds, setDisabledPhoneIds] = useState<Set<string>>(new Set())
  const [isTalkPressed, setIsTalkPressed] = useState(false)
  const [showIFB, setShowIFB] = useState(false)
  const [showFeed, setShowFeed] = useState(false)
  const [editName, setEditName] = useState(false)
  const [editCode, setEditCode] = useState(false)
  const [tempName, setTempName] = useState(client.name)
  const [tempCode, setTempCode] = useState(client.code)
  const [feedSourceId, setFeedSourceId] = useState<string>("")
  const [feedEnabled, setFeedEnabled] = useState(false)
  const [feedVolume, setFeedVolume] = useState(80)
  const feedRef = useRef({ sourceId: "", enabled: false })
  const isTalkPressedRef = useRef(false)
  const allClientsRef = useRef(allClients)
  useEffect(() => { allClientsRef.current = allClients }, [allClients])

  useEffect(() => {
    return subscribeToLevels(levels => {
      setSnd(levels[client.id] ?? 0)
      setRcv(levels[`recv_${client.id}`] ?? 0)
    })
  }, [client.id])

  useEffect(() => {
    const handler = (allConns: Array<{ from: string; to: string; channel: number }>) => {
      const routes = allConns
        .filter(c => c.to === client.id && c.channel === 2 && c.from !== 'producer-65' && c.from !== 'host-ui')
        .map(c => {
          const cl = allClientsRef.current.find(a => a.id === c.from)
          return { from: c.from, name: cl?.name ?? c.from.slice(0, 6) }
        })
      setPhoneRoutes(routes)
      setDisabledPhoneIds(prev => {
        if (prev.size === 0) return prev
        const next = new Set(prev)
        routes.forEach(r => next.delete(r.from))
        return next.size === prev.size ? prev : next
      })
    }
    socket.on('connections:all', handler)
    socket.emit('connections:request:all')
    return () => { socket.off('connections:all', handler) }
  }, [client.id])

  const togglePhoneRoute = (phoneId: string, isEnabled: boolean) => {
    if (isEnabled) {
      socket.emit('connection:remove', { from: phoneId, to: client.id, channel: 2, bidirectional: false })
      setDisabledPhoneIds(prev => new Set([...prev, phoneId]))
      setPhoneRoutes(prev => prev.filter(r => r.from !== phoneId))
    } else {
      socket.emit('connection:create', { from: phoneId, to: client.id, channel: 2, bidirectional: false })
      setDisabledPhoneIds(prev => { const n = new Set(prev); n.delete(phoneId); return n })
    }
  }

  const handleTalkDown = async (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    setIsTalkPressed(true)
    isTalkPressedRef.current = true
    onUpdate({ isIFBActive: true })
    const startFn = (window as any).__easycomStartMic
    try { if (startFn) await startFn() } catch (err) { console.warn('[TB] startMic failed:', err) }
    // If button was released while mic was starting, skip — connection:remove already fired
    if (!isTalkPressedRef.current) return
    acquireConnection("producer-65", client.id, 1)
    if (ifb.active) socket.emit("ifb:activate", { targetClientId: client.id, settings: ifb })
  }

  const handleTalkUp = (e: React.PointerEvent) => {
    e.currentTarget.releasePointerCapture(e.pointerId)
    setIsTalkPressed(false)
    isTalkPressedRef.current = false
    onUpdate({ isIFBActive: false })
    if (!client.isLatched) {
      releaseConnection("producer-65", client.id, 1)
    }
    if (ifb.active) socket.emit("ifb:deactivate", { targetClientId: client.id })
  }

  const handleLatch = () => {
    const nowLatched = !client.isLatched
    onUpdate({ isLatched: nowLatched })
    if (nowLatched) {
      ;(window as any).__easycomStartMic?.()
      acquireConnection("producer-65", client.id, 1)
    } else {
      if (!isTalkPressed) {
        releaseConnection("producer-65", client.id, 1)
      }
    }
  }

  const isTalking = client.isTalking || client.isLatched || isTalkPressed || snd > 20
  const isOnline = client.status === "online"
  const themeColor = theme === "orange" ? "orange" : "blue"
  const ifb: IFBSettings = (client as any).ifbSettings ?? defaultIFB()
  const auxLevel = client.auxLevel ?? 80

  const saveName = () => { onUpdate({ name: tempName || client.name }); setEditName(false) }
  const saveCode = () => { onUpdate({ code: tempCode.slice(0, 4) }); setEditCode(false) }

  const getFeedStream = (sourceId: string): MediaStream | null => {
    const match = sourceId.match(/bridge-ch(\d+)/)
    if (match) return getChannelStream(parseInt(match[1]))
    return getClientMonitorStream(sourceId)
  }

  const handleFeedToggle = () => {
    const newEnabled = !feedEnabled
    setFeedEnabled(newEnabled)
    feedRef.current.enabled = newEnabled
    if (feedSourceId) {
      if (newEnabled) {
        const stream = getFeedStream(feedSourceId)
        if (stream) startFeedMonitor(feedSourceId, stream, feedVolume)
      } else {
        stopFeedMonitor(feedSourceId)
      }
    }
  }

  const handleFeedSourceChange = (newSource: string) => {
    if (feedEnabled && feedSourceId) stopFeedMonitor(feedSourceId)
    setFeedSourceId(newSource)
    feedRef.current.sourceId = newSource
    if (feedEnabled && newSource) {
      const stream = getFeedStream(newSource)
      if (stream) startFeedMonitor(newSource, stream, feedVolume)
    }
  }

  const handleFeedVolume = (vol: number) => {
    setFeedVolume(vol)
    setFeedMonitorVolume(feedSourceId, vol)
  }

  // Stop local monitor on unmount
  useEffect(() => () => {
    if (feedRef.current.enabled && feedRef.current.sourceId) {
      stopFeedMonitor(feedRef.current.sourceId)
    }
  }, [client.id])

  const updateIFB = (s: IFBSettings) => {
    onUpdate({ ifbSettings: s } as any)
    socket.emit("ifb:settings:update", { clientId: client.id, settings: s })
  }

  const activateIFB = () => {
    const s = { ...ifb, active: true }
    updateIFB(s); onUpdate({ ifbActive: true } as any)
    socket.emit("ifb:activate", { targetClientId: client.id, settings: s })
  }

  const deactivateIFB = () => {
    const s = { ...ifb, active: false }
    updateIFB(s); onUpdate({ ifbActive: false } as any)
    socket.emit("ifb:deactivate", { targetClientId: client.id })
  }

  return (
    <div className="relative">
      <div
        id={`client-${client.id}`}
        data-client-id={client.id}
        className={`relative flex flex-col aspect-[1/1.25] bg-zinc-900 border rounded-lg overflow-hidden
          ${isTalking ? `ring-2 ring-${themeColor}-500` : ""}
          ${isSelected ? `border-${themeColor}-500 bg-${themeColor}-600/5` : "border-white/5"}
          ${(client as any).ifbActive ? "ring-2 ring-blue-500" : ""}
          ${isMixerOpen ? "border-blue-400/40" : ""}`}
      >
        {/* HEADER */}
        <div style={{ background: client.color || "#444" }} className="flex items-center justify-between px-2 py-1">
          <div className="flex items-center gap-1">
            {client.type === "mobile" && <Smartphone size={10} />}
            {client.type === "desktop" && <Monitor size={10} />}
            {client.type === "remote" && <Tablet size={10} />}
            {editName
              ? <input autoFocus value={tempName} onChange={e => setTempName(e.target.value)}
                  onBlur={saveName} onKeyDown={e => e.key==="Enter" && saveName()}
                  onClick={e => e.stopPropagation()} className="text-[10px] bg-black/40 px-1 w-14 rounded" />
              : <span onDoubleClick={e => { e.stopPropagation(); setTempName(client.name); setEditName(true) }}
                  className="text-[10px] font-bold text-white cursor-pointer truncate max-w-[60px]">
                  {client.name}
                </span>
            }
          </div>
          <div className="flex items-center gap-1">
            {(client.videoSources?.length ?? 0) > 0 && <Video size={10} />}
            <div className={`w-2 h-2 rounded-full ${isOnline ? "bg-green-500" : "bg-zinc-700"}`} />
          </div>
        </div>

        {/* ROLE SELECTOR */}
        {roles.length > 0 && (
          <div className="px-2 py-1 border-b border-black/20" onClick={e => e.stopPropagation()}>
            {(() => {
              const activeRole = roles.find(r => r.id === client.customRole)
              return (
                <select
                  value={client.customRole ?? ""}
                  onChange={e => onUpdate({ customRole: e.target.value || undefined })}
                  onMouseDown={stopDrag}
                  className="w-full text-[8px] font-bold rounded px-1 py-0.5 border-0 outline-none cursor-pointer"
                  style={{
                    background: activeRole ? activeRole.color + "33" : "rgba(0,0,0,0.25)",
                    color: activeRole ? activeRole.color : "rgba(255,255,255,0.4)"
                  }}
                >
                  <option value="">— no role —</option>
                  {roles.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
                </select>
              )
            })()}
          </div>
        )}

        <div className="flex-1 p-1.5 flex flex-col gap-1">

          {/* METERS */}
          <div className="flex items-center gap-1">
            <div className="flex-1 h-2 bg-black rounded overflow-hidden">
              <div className="h-full rounded"
                style={{ width: `${Math.min(100,snd)}%`, background: snd > 75 ? "#ef4444" : snd > 40 ? "#eab308" : "#22c55e", transition: "width 50ms" }} />
            </div>
            <Bar level={snd} color="#22c55e" />
            <Bar level={rcv} color="#3b82f6" />
          </div>

          <div className="flex gap-2 px-0.5">
            <div className="flex items-center gap-0.5"><div className="w-1.5 h-1.5 rounded-sm bg-green-500 opacity-50" /><span className="text-[7px] text-white/30">SEND</span></div>
            <div className="flex items-center gap-0.5"><div className="w-1.5 h-1.5 rounded-sm bg-blue-500 opacity-50" /><span className="text-[7px] text-white/30">RECV</span></div>
          </div>





          {/* TALK */}
          <div className="flex gap-1">
            <button
              onPointerDown={handleTalkDown}
              onPointerUp={handleTalkUp}
              onPointerCancel={handleTalkUp}
              className="flex-[3] py-2 rounded flex items-center justify-center transition-colors touch-none"
              style={isTalkPressed
                ? { background: "#22c55e", boxShadow: "0 0 12px #22c55e60" }
                : { background: "rgb(39,39,42)" }
              }
            >
              <Mic size={20} style={{ color: isTalkPressed ? "white" : "rgba(255,255,255,0.7)" }} />
            </button>
            <button
              onClick={() => onUpdate({ isMuted: !client.isMuted })}
              className="px-2 rounded flex items-center justify-center"
              style={{ background: "rgb(39,39,42)" }}
            >
              {client.isMuted ? <VolumeX size={14} /> : <Volume2 size={14} />}
            </button>
          </div>

          {/* LATCH + IFB + FEED */}
          <div className="flex gap-1">
            <button onClick={handleLatch}
              className="flex-1 flex items-center justify-center gap-0.5 py-0.5 rounded text-[8px] font-bold"
              style={client.isLatched
                ? { background: "#f9731620", border: "1px solid #f97316", color: "#f97316" }
                : client.remoteIsLatched
                  ? { background: "#a855f720", border: "1px solid #a855f7", color: "#a855f7" }
                  : { background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.4)" }}>
              <Lock size={8} /> {client.remoteIsLatched && !client.isLatched ? 'REM' : 'LATCH'}
            </button>
            <button onClick={e => { e.stopPropagation(); setShowIFB(p => !p); setShowFeed(false) }}
              className="flex-1 flex items-center justify-center gap-0.5 py-0.5 rounded text-[8px] font-bold"
              style={(client as any).ifbActive
                ? { background: "#3b82f620", border: "1px solid #3b82f6", color: "#3b82f6" }
                : { background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.4)" }}>
              <Headphones size={8} /> IFB
            </button>
            <button onClick={e => { e.stopPropagation(); setShowFeed(p => !p); setShowIFB(false) }}
              title="Monitor a source locally on the host"
              className="flex-1 flex items-center justify-center gap-0.5 py-0.5 rounded text-[8px] font-bold"
              style={feedEnabled && feedSourceId
                ? { background: "#22c55e20", border: "1px solid #22c55e", color: "#22c55e" }
                : { background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.4)" }}>
              <Radio size={8} /> FEED
            </button>
          </div>

          {/* PHONE CH2 ROUTES */}
          {(phoneRoutes.length > 0 || disabledPhoneIds.size > 0) && (
            <div className="flex flex-col gap-0.5">
              {phoneRoutes.map(r => (
                <div key={r.from} className="flex items-center gap-1 px-0.5">
                  <span className="text-[7px]" style={{ color: '#3b82f6' }}>⇢</span>
                  <span className="text-[7px] text-white/50 flex-1 truncate">{r.name}</span>
                  <button onPointerDown={stopDrag} onClick={e => { e.stopPropagation(); togglePhoneRoute(r.from, true) }}
                    className="w-3 h-3 rounded-full flex items-center justify-center"
                    style={{ background: '#22c55e30', border: '1px solid #22c55e' }}
                    title="Disable phone route">
                    <span style={{ fontSize: 4, color: '#22c55e', lineHeight: 1 }}>●</span>
                  </button>
                </div>
              ))}
              {[...disabledPhoneIds].map(phoneId => {
                const name = allClients.find(a => a.id === phoneId)?.name ?? phoneId.slice(0, 6)
                return (
                  <div key={phoneId} className="flex items-center gap-1 px-0.5">
                    <span className="text-[7px]" style={{ color: '#ef4444' }}>✕</span>
                    <span className="text-[7px] text-white/30 flex-1 truncate line-through">{name}</span>
                    <button onPointerDown={stopDrag} onClick={e => { e.stopPropagation(); togglePhoneRoute(phoneId, false) }}
                      className="w-3 h-3 rounded-full flex items-center justify-center"
                      style={{ background: '#ef444430', border: '1px solid #ef4444' }}
                      title="Re-enable phone route">
                      <span style={{ fontSize: 4, color: '#ef4444', lineHeight: 1 }}>●</span>
                    </button>
                  </div>
                )
              })}
            </div>
          )}

          {/* PIN + ACTIONS on same row */}
          <div className="flex items-center justify-between px-0.5">
            <div className="flex items-center gap-1" onDoubleClick={() => setEditCode(true)}>
              <span className="text-[8px] font-black uppercase" style={{ color: 'rgba(255,255,255,0.3)' }}>PIN</span>
              {editCode
                ? <input autoFocus value={tempCode} onChange={e => setTempCode(e.target.value)}
                    onBlur={saveCode} onKeyDown={e => e.key==="Enter" && saveCode()}
                    className="bg-black text-[9px] px-1 w-10 rounded border border-white/20 text-white outline-none" />
                : <span className="text-[9px] font-mono font-bold" style={{ color: 'rgba(255,255,255,0.45)', letterSpacing: '0.1em' }}>{client.code || '0000'}</span>
              }
            </div>
            <div className="flex gap-1.5 text-xs opacity-60">
              <button onClick={() => { onUpdate({ status:"offline", isTalking:false, isLatched:false }); socket.emit("client:kick", { clientId: client.id }) }} className="hover:text-red-500 hover:opacity-100 p-0.5"><UserX size={14} /></button>
              <button onClick={onMapKey} className="hover:text-yellow-400 hover:opacity-100 p-0.5"><Keyboard size={14} /></button>
              <button onClick={e => { e.stopPropagation(); onToggleMixer() }} className={(isMixerOpen ? "text-blue-400" : "") + " hover:text-blue-400 hover:opacity-100 p-0.5"}><SlidersHorizontal size={14} /></button>
              <button onClick={e => { e.stopPropagation(); setShowGain(p => !p) }} className={(showGain ? "text-yellow-400 opacity-100" : "") + " hover:text-yellow-400 hover:opacity-100 p-0.5"}><Gauge size={14} /></button>
            </div>
          </div>

          {showGain && (
            <div className="flex items-center gap-1 px-0.5">
              <span className="text-[7px] text-white/30 shrink-0">GAIN</span>
              <button onClick={e => { e.stopPropagation(); const v = Math.max(0, baseGain - 10); setBaseGain(v); onBaseGainChange?.(v); socket.emit('audio:gain', { clientId: client.id, gain: v / 100 }) }}
                className="w-7 h-7 rounded-lg flex items-center justify-center text-sm font-black text-white"
                style={{ background: "rgba(239,68,68,0.7)" }}>−</button>
              <span className="flex-1 text-center text-[10px] font-mono font-bold text-white/70">{baseGain}%</span>
              <button onClick={e => { e.stopPropagation(); const v = Math.min(100, baseGain + 10); setBaseGain(v); onBaseGainChange?.(v); socket.emit('audio:gain', { clientId: client.id, gain: v / 100 }) }}
                className="w-7 h-7 rounded-lg flex items-center justify-center text-sm font-black text-white"
                style={{ background: "rgba(34,197,94,0.7)" }}>+</button>
            </div>
          )}

          {/* TALLY */}
          <div className="flex gap-1">
            <button
              onClick={e => { e.stopPropagation(); onTallySet?.(tallyState === 'program' ? 'off' : 'program') }}
              className="flex-1 flex items-center justify-center py-0.5 rounded text-[8px] font-black uppercase"
              style={tallyState === 'program'
                ? { background: "#ef4444", color: "white", boxShadow: "0 0 8px #ef444460" }
                : { background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", color: "rgba(239,68,68,0.5)" }}>
              R
            </button>
            <button
              onClick={e => { e.stopPropagation(); onTallySet?.(tallyState === 'preview' ? 'off' : 'preview') }}
              className="flex-1 flex items-center justify-center py-0.5 rounded text-[8px] font-black uppercase"
              style={tallyState === 'preview'
                ? { background: "#22c55e", color: "white", boxShadow: "0 0 8px #22c55e60" }
                : { background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.3)", color: "rgba(34,197,94,0.5)" }}>
              P
            </button>
          </div>

        </div>
      </div>

      {showIFB && (
        <IFBPanel settings={ifb} onChange={updateIFB} onClose={() => setShowIFB(false)}
          onActivate={activateIFB} onDeactivate={deactivateIFB}
          clientName={client.name} theme={theme} />
      )}

      {showFeed && (
        <FeedPanel
          clientName={client.name}
          sources={feedSources}
          sourceId={feedSourceId}
          enabled={feedEnabled}
          volume={feedVolume}
          onSourceChange={handleFeedSourceChange}
          onToggle={handleFeedToggle}
          onVolume={handleFeedVolume}
          onClose={() => setShowFeed(false)}
        />
      )}
    </div>
  )
}

type FeedPanelProps = {
  clientName: string
  sources: FeedSource[]
  sourceId: string
  enabled: boolean
  volume: number
  onSourceChange: (id: string) => void
  onToggle: () => void
  onVolume: (vol: number) => void
  onClose: () => void
}

function FeedPanel({ clientName, sources, sourceId, enabled, volume, onSourceChange, onToggle, onVolume, onClose }: FeedPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) onClose()
    }
    const t = setTimeout(() => window.addEventListener("mousedown", handler), 100)
    return () => { clearTimeout(t); window.removeEventListener("mousedown", handler) }
  }, [onClose])

  return (
    <div
      ref={panelRef}
      className="absolute top-full left-0 mt-1 z-50 rounded-2xl overflow-hidden shadow-2xl"
      style={{
        width: 240,
        background: "linear-gradient(160deg, #1c1c1e 0%, #111 100%)",
        border: "1px solid rgba(255,255,255,0.08)",
        boxShadow: "0 24px 48px rgba(0,0,0,0.9), inset 0 1px 0 rgba(255,255,255,0.06)"
      }}
    >
      {/* HEADER */}
      <div className="flex items-center justify-between px-4 py-3"
        style={{ background: "linear-gradient(90deg, #22c55e20, transparent)", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        <div className="flex items-center gap-2">
          <Radio size={13} style={{ color: "#22c55e" }} />
          <div>
            <div className="text-[9px] text-white/30 font-mono uppercase tracking-widest">FEED</div>
            <div className="text-xs font-bold text-white">{clientName}</div>
          </div>
        </div>
        <button onClick={onClose} className="p-1 rounded hover:bg-white/10 text-white/30 hover:text-white">
          <span style={{ fontSize: 13, lineHeight: 1 }}>✕</span>
        </button>
      </div>

      <div className="p-4 space-y-4">
        {/* SOURCE PICKER */}
        <div>
          <p className="text-[8px] text-white/30 uppercase tracking-widest mb-1.5">Source</p>
          {sources.length === 0 ? (
            <p className="text-[9px] text-white/20 italic">No sources available</p>
          ) : (
            <div className="relative">
              <select
                value={sourceId}
                onChange={e => onSourceChange(e.target.value)}
                onClick={e => e.stopPropagation()}
                className="w-full appearance-none rounded-lg px-3 py-1.5 text-[10px] font-bold text-white pr-7"
                style={{ background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.12)", outline: "none" }}
              >
                <option value="" style={{ background: "#1c1c1e" }}>— Select source —</option>
                {sources.map(s => (
                  <option key={s.id} value={s.id} style={{ background: "#1c1c1e" }}>{s.label}</option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* ON / OFF */}
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-bold text-white">Active</p>
            <p className="text-[9px] text-white/30">Monitor on host only</p>
          </div>
          <button
            onClick={onToggle}
            disabled={!sourceId}
            className="relative w-10 h-5 rounded-full transition-all"
            style={{
              background: enabled && sourceId ? "#22c55e" : "rgba(255,255,255,0.1)",
              boxShadow: enabled && sourceId ? "0 0 10px #22c55e60" : "none",
              opacity: sourceId ? 1 : 0.4
            }}
          >
            <div className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all"
              style={{ left: enabled && sourceId ? "22px" : "2px" }} />
          </button>
        </div>

        {/* VOLUME */}
        <div>
          <div className="flex justify-between mb-1.5">
            <p className="text-[8px] text-white/30 uppercase tracking-widest">Volume</p>
            <span className="text-[8px] font-mono text-white/50">{volume}%</span>
          </div>
          <input
            type="range" min={0} max={100} value={volume}
            onChange={e => onVolume(Number(e.target.value))}
            onClick={e => e.stopPropagation()}
            className="w-full h-1 appearance-none cursor-pointer rounded"
            style={{ accentColor: "#22c55e" }}
          />
        </div>
      </div>
    </div>
  )
}

export default ClientStrip
