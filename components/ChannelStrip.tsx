import React, { useState, useEffect } from 'react'
import { Client, ChannelMixerSettings } from '../types'
import { subscribeToLevels, socket } from '../client/webrtc/intercom'
import IFBPanel, { IFBSettings } from './IFBPanel'
import { Mic, Volume2, VolumeX, Smartphone, Monitor, Tablet, UserX, Zap, Keyboard, Video, SlidersHorizontal, Headphones, Lock } from 'lucide-react'

type Props = {
  client: Client
  isSelected: boolean
  onUpdate: (updates: Partial<Client>) => void
  theme: 'orange' | 'blue'
  onHijack?: () => void
  onMapKey?: () => void
  isMixerOpen?: boolean
  onToggleMixer?: () => void
}

const defaultIFB = (): IFBSettings => ({ active: false, channels: {} })
const MAX_CH = 16
const chColors = ["#ef4444","#3b82f6","#22c55e","#a855f7","#f97316","#06b6d4","#eab308","#ec4899","#84cc16","#0ea5e9","#f43f5e","#8b5cf6","#10b981","#fb923c","#a78bfa","#34d399"]

function Bar({ level, color }: { level: number; color: string }) {
  const segs = 8
  return (
    <div style={{ display: "flex", flexDirection: "column-reverse", gap: 1, width: 5, height: 28 }}>
      {Array.from({ length: segs }, (_, i) => {
        const t = (i + 1) / segs
        const on = level / 100 >= t
        return <div key={i} style={{ flex: 1, borderRadius: 1, background: on ? t > 0.85 ? "#ef4444" : t > 0.6 ? "#eab308" : color : "rgba(255,255,255,0.07)" }} />
      })}
    </div>
  )
}

const ClientStrip: React.FC<Props> = ({
  client, isSelected, onUpdate, theme,
  onHijack = () => {}, onMapKey = () => {},
  isMixerOpen = false, onToggleMixer = () => {}
}) => {

  // 🔥 State-based – triggers re-render on level change
  const [snd, setSnd] = useState(0)
  const [rcv, setRcv] = useState(0)

  // 🔥 Subscribe – this is what drives the meters
  useEffect(() => {
    return subscribeToLevels(levels => {
      setSnd(levels[client.id] ?? 0)
      setRcv(levels[`recv_${client.id}`] ?? 0)
    })
  }, [client.id])

  const [editName, setEditName] = useState(false)
  const [editCode, setEditCode] = useState(false)
  const [tempName, setTempName] = useState(client.name)
  const [tempCode, setTempCode] = useState(client.code)
  const [showIFB, setShowIFB] = useState(false)

  const isTalking = client.isTalking || client.isLatched || client.isIFBActive || snd > 20
  const isOnline = client.status === "online"
  const themeColor = theme === "orange" ? "orange" : "blue"
  const rxCh = client.receiveChannels ?? [1]
  const ifb: IFBSettings = (client as any).ifbSettings ?? defaultIFB()

  const saveName = () => { onUpdate({ name: tempName || client.name }); setEditName(false) }
  const saveCode = () => { onUpdate({ code: tempCode.slice(0, 4) }); setEditCode(false) }

  const toggleRxCh = (ch: number) => {
    const next = rxCh.includes(ch) ? rxCh.filter(c => c !== ch) : [...rxCh, ch].sort((a,b)=>a-b)
    if (next.length === 0) return
    onUpdate({ receiveChannels: next })
  }

  const updateIFB = (s: IFBSettings) => {
    onUpdate({ ifbSettings: s } as any)
    socket.emit("ifb:settings:update", { clientId: client.id, settings: s })
  }

  const activateIFB = () => {
    const s = { ...ifb, active: true }
    updateIFB(s); onUpdate({ ifbActive: true })
    socket.emit("ifb:activate", { targetClientId: client.id, settings: s })
  }

  const deactivateIFB = () => {
    const s = { ...ifb, active: false }
    updateIFB(s); onUpdate({ ifbActive: false })
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
          ${client.ifbActive ? "ring-2 ring-blue-500" : ""}
          ${isMixerOpen ? "border-blue-400/40" : ""}`}
      >
        {/* HEADER */}
        <div style={{ background: client.color }} className="flex items-center justify-between px-2 py-1">
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
            {client.videoSources?.length > 0 && <Video size={10} />}
            <div className={`w-2 h-2 rounded-full ${isOnline ? "bg-green-500" : "bg-zinc-700"}`} />
          </div>
        </div>

        {/* CHANNEL INDICATORS */}
        <div className="flex gap-0.5 px-1.5 pt-1">
          {Array.from({ length: MAX_CH }, (_, i) => {
            const ch = i + 1; const active = rxCh.includes(ch)
            return <button key={ch} onClick={e => { e.stopPropagation(); toggleRxCh(ch) }}
              className="flex-1 h-1.5 rounded-sm"
              style={{ background: active ? chColors[(ch-1)%chColors.length] : "rgba(255,255,255,0.08)" }} />
          })}
        </div>

        <div className="flex-1 p-1.5 flex flex-col gap-1">

          {/* 🔥 METERS */}
          <div className="flex items-center gap-1">
            {/* Horizontal bar */}
            <div className="flex-1 h-2 bg-black rounded overflow-hidden">
              <div className="h-full rounded"
                style={{ width: `${Math.min(100,snd)}%`, background: snd > 75 ? "#ef4444" : snd > 40 ? "#eab308" : "#22c55e", transition: "width 60ms" }} />
            </div>
            {/* SND + RCV vertical bars */}
            <Bar level={snd} color="#22c55e" />
            <Bar level={rcv} color="#3b82f6" />
          </div>

          <div className="flex gap-2 px-0.5">
            <div className="flex items-center gap-0.5"><div className="w-1.5 h-1.5 rounded-sm bg-green-500 opacity-50" /><span className="text-[7px] text-white/20">SND</span></div>
            <div className="flex items-center gap-0.5"><div className="w-1.5 h-1.5 rounded-sm bg-blue-500 opacity-50" /><span className="text-[7px] text-white/20">RCV</span></div>
          </div>

          {/* GAIN */}
          <input type="range" min={0} max={100} value={client.gain}
            onChange={e => onUpdate({ gain: Number(e.target.value) })}
            className="h-1 appearance-none cursor-pointer rounded bg-black" />

          {/* TALK + MUTE */}
          <div className="flex gap-1">
            <button
              onMouseDown={() => onUpdate({ isIFBActive: true })}
              onMouseUp={() => onUpdate({ isIFBActive: false })}
              className={`flex-[3] py-2 rounded flex items-center justify-center ${isTalking ? "bg-green-600" : "bg-zinc-800 hover:bg-zinc-700"}`}>
              <Mic size={20} />
            </button>
            <button onClick={() => onUpdate({ isMuted: !client.isMuted })}
              className="px-2 bg-zinc-800 hover:bg-zinc-700 rounded flex items-center justify-center">
              {client.isMuted ? <VolumeX size={14} /> : <Volume2 size={14} />}
            </button>
          </div>

          {/* LATCH + IFB */}
          <div className="flex gap-1">
            <button onClick={() => onUpdate({ isLatched: !client.isLatched })}
              className="flex-1 flex items-center justify-center gap-0.5 py-0.5 rounded text-[8px] font-bold"
              style={client.isLatched
                ? { background: "#f9731620", border: "1px solid #f97316", color: "#f97316" }
                : { background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.4)" }}>
              <Lock size={8} /> LATCH
            </button>
            <button onClick={e => { e.stopPropagation(); setShowIFB(p => !p) }}
              className="flex-1 flex items-center justify-center gap-0.5 py-0.5 rounded text-[8px] font-bold"
              style={client.ifbActive
                ? { background: "#3b82f620", border: "1px solid #3b82f6", color: "#3b82f6" }
                : { background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.4)" }}>
              <Headphones size={8} /> IFB
              {client.ifbActive && <span className="w-1 h-1 rounded-full bg-blue-400 animate-pulse ml-0.5" />}
            </button>
          </div>

          {/* PIN CODE */}
          <div className="flex items-center gap-1" onDoubleClick={() => setEditCode(true)}>
            <span className="text-[8px] font-bold text-zinc-600">PIN</span>
            {editCode
              ? <input autoFocus value={tempCode} onChange={e => setTempCode(e.target.value)}
                  onBlur={saveCode} onKeyDown={e => e.key==="Enter" && saveCode()}
                  className="bg-black text-[10px] px-1 w-14 rounded" />
              : <span className="text-[9px] text-zinc-500">{client.code}</span>
            }
          </div>

          {/* ACTIONS */}
          <div className="flex justify-between text-xs opacity-70">
            <button onClick={() => onUpdate({ status:"offline", isTalking:false, isLatched:false })} className="hover:text-red-500"><UserX size={12} /></button>
            <button onClick={onMapKey} className="hover:text-yellow-400"><Keyboard size={12} /></button>
            <button onClick={e => { e.stopPropagation(); onToggleMixer() }} className={isMixerOpen ? "text-blue-400" : "hover:text-blue-400"}><SlidersHorizontal size={12} /></button>
            <button onClick={onHijack} className="hover:text-orange-400"><Zap size={12} /></button>
          </div>

        </div>
      </div>

      {showIFB && (
        <IFBPanel settings={ifb} onChange={updateIFB} onClose={() => setShowIFB(false)}
          onActivate={activateIFB} onDeactivate={deactivateIFB}
          clientName={client.name} theme={theme} />
      )}
    </div>
  )
}

export default ClientStrip
