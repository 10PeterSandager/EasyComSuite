import React, { useState, useEffect } from "react"
import { socket } from "../client/webrtc/intercom"
import { Client } from "../types"
import { Trash2, Check, X, UserPlus, UserMinus, Power } from "lucide-react"

export type Group = {
  id: string
  name: string
  members: string[]
  channel: number
  color: string
}

const GROUP_COLORS = [
  "#ef4444","#f97316","#eab308","#22c55e",
  "#06b6d4","#3b82f6","#a855f7","#ec4899"
]

type Props = {
  group: Group
  clients: Client[]
  isActive: boolean
  onActivate: () => void
  onDeactivate: () => void
  onDelete: () => void
  onUpdate: (g: Group) => void
}

export default function GroupStrip({ group, clients, isActive, onActivate, onDeactivate, onDelete, onUpdate }: Props) {
  const [editingName, setEditingName] = useState(false)
  const [tempName, setTempName] = useState(group.name)
  const [editingMembers, setEditingMembers] = useState(false)

  const memberClients = group.members
    .map(id => clients.find(c => c.id === id))
    .filter(Boolean) as Client[]

  const saveName = () => {
    const name = tempName.trim() || group.name
    onUpdate({ ...group, name })
    setEditingName(false)
  }

  const toggleMember = (id: string) => {
    const members = group.members.includes(id)
      ? group.members.filter(m => m !== id)
      : [...group.members, id]
    if (members.length === 0) return
    onUpdate({ ...group, members })
  }

  const handleToggleActive = () => {
    if (isActive) onDeactivate()
    else onActivate()
  }

  const stripeStyle = {
    background: `repeating-linear-gradient(
      45deg,
      ${group.color}cc,
      ${group.color}cc 5px,
      ${group.color}44 5px,
      ${group.color}44 10px
    )`
  }

  return (
    <div
      className="relative flex flex-col bg-zinc-900 border rounded-lg overflow-hidden"
      style={{ borderColor: isActive ? group.color + "80" : group.color + "30",
               boxShadow: isActive ? `0 0 10px ${group.color}30` : "none" }}
    >
      {/* STRIPED HEADER */}
      <div style={stripeStyle} className="flex items-center justify-between px-2 py-1 min-h-[24px]">
        <div className="flex items-center gap-1 flex-1 min-w-0">
          <span className="text-[8px] font-black" style={{ color: "#000", opacity: 0.7, letterSpacing: 1 }}>GRP</span>
          {editingName ? (
            <input
              autoFocus
              value={tempName}
              onChange={e => setTempName(e.target.value)}
              onBlur={saveName}
              onKeyDown={e => { if (e.key === "Enter") saveName() }}
              onClick={e => e.stopPropagation()}
              className="text-[10px] font-bold bg-black/50 border border-white/30 rounded px-1 w-full min-w-0"
              style={{ color: "#fff" }}
            />
          ) : (
            <span
              onDoubleClick={e => { e.stopPropagation(); setTempName(group.name); setEditingName(true) }}
              className="text-[10px] font-bold truncate cursor-pointer"
              style={{ color: "#fff", textShadow: "0 1px 2px rgba(0,0,0,0.6)" }}
            >
              {group.name}
            </span>
          )}
        </div>
        <div className="w-2 h-2 rounded-full shrink-0"
          style={{ background: isActive ? "#22c55e" : "#555", boxShadow: isActive ? "0 0 4px #22c55e" : "none" }} />
      </div>

      <div className="flex-1 p-1.5 flex flex-col gap-1.5">

        {/* MEMBER DOTS */}
        <div className="flex flex-wrap gap-1 min-h-[20px] items-center">
          {memberClients.length === 0 ? (
            <span className="text-[8px] text-white/20 italic">No members</span>
          ) : memberClients.map(c => (
            <div key={c.id} className="flex items-center gap-0.5" title={c.name}>
              <div className="w-3 h-3 rounded-full border border-black/30"
                style={{ background: c.color || "#555" }} />
            </div>
          ))}
        </div>

        {/* MEMBER COUNT + CHANNEL */}
        <div className="flex items-center justify-between px-0.5">
          <span className="text-[8px] text-white/40">{group.members.length} members · CH{group.channel}</span>
          <div className="flex gap-0.5 flex-wrap justify-end">
            {memberClients.slice(0,2).map(c => (
              <span key={c.id} className="text-[7px] text-white/30 truncate max-w-[28px]">{c.name}</span>
            ))}
            {memberClients.length > 2 && (
              <span className="text-[7px] text-white/20">+{memberClients.length - 2}</span>
            )}
          </div>
        </div>

        {/* ACTIVE TOGGLE */}
        <button
          onClick={handleToggleActive}
          className="flex items-center justify-center gap-1 py-1.5 rounded font-black text-[9px] uppercase tracking-widest transition-all"
          style={isActive
            ? { background: group.color + "30", border: `1px solid ${group.color}`, color: group.color }
            : { background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.4)" }
          }
        >
          <Power size={10} /> {isActive ? "ACTIVE" : "ENABLE"}
        </button>

        {/* EDIT + DELETE */}
        <div className="flex gap-1">
          <button
            onClick={e => { e.stopPropagation(); setEditingMembers(p => !p) }}
            className="flex-1 flex items-center justify-center gap-0.5 py-0.5 rounded text-[8px] font-bold"
            style={editingMembers
              ? { background: group.color + "20", border: `1px solid ${group.color}`, color: group.color }
              : { background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.3)" }
            }
          >
            <UserPlus size={9} /> EDIT
          </button>
          <button
            onClick={onDelete}
            className="px-2 py-0.5 rounded text-[8px] hover:bg-red-600/20 hover:text-red-400"
            style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.2)" }}
          >
            <Trash2 size={9} />
          </button>
        </div>

      </div>

      {/* MEMBER EDITOR OVERLAY */}
      {editingMembers && (
        <div className="absolute inset-0 z-10 rounded-lg overflow-hidden flex flex-col"
          style={{ background: "rgba(10,10,10,0.97)", border: `1px solid ${group.color}40` }}>
          <div className="flex items-center justify-between px-2 py-1.5"
            style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
            <span className="text-[9px] font-black uppercase text-white/60">Members</span>
            <button onClick={() => setEditingMembers(false)} className="text-white/30 hover:text-white">
              <X size={11} />
            </button>
          </div>
          <div className="flex-1 overflow-auto p-1.5 space-y-1">
            {clients.map(c => {
              const inGroup = group.members.includes(c.id)
              return (
                <button key={c.id}
                  onClick={() => toggleMember(c.id)}
                  className="w-full flex items-center gap-1.5 px-2 py-1 rounded text-left"
                  style={inGroup
                    ? { background: group.color + "20", border: `1px solid ${group.color}40`, color: "#fff" }
                    : { background: "rgba(255,255,255,0.04)", border: "1px solid transparent", color: "rgba(255,255,255,0.4)" }
                  }
                >
                  <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: c.color || "#555" }} />
                  <span className="text-[8px] font-bold flex-1 truncate">{c.name}</span>
                  {inGroup && <Check size={8} style={{ color: group.color }} />}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
