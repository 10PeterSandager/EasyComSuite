import { useEffect, useState } from "react"
import { socket } from "../client/webrtc/intercom"
import { Client } from "../types"
import { Plus, Trash2, Users, Mic, Lock, X } from "lucide-react"

type Group = {
  id: string
  name: string
  members: string[]
  channel: number
  color: string
  isLatched?: boolean
}

type Props = {
  clients: Client[]
  theme?: "orange" | "blue"
  myId?: string
}

const GROUP_COLORS = [
  "#ef4444","#f97316","#eab308","#22c55e",
  "#06b6d4","#3b82f6","#a855f7","#ec4899"
]

export default function GroupPanel({ clients, theme = "orange", myId }: Props) {

  const [groups, setGroups] = useState<Group[]>([])
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState("")
  const [newMembers, setNewMembers] = useState<string[]>([])
  const [newChannel, setNewChannel] = useState(1)
  const [newColor, setNewColor] = useState(GROUP_COLORS[0])
  const [activeGroups, setActiveGroups] = useState<Set<string>>(new Set())

  const themeColor = theme === "orange" ? "orange" : "blue"

  /* ---------- LOAD ---------- */

  useEffect(() => {
    socket.emit("group:list", (g: Group[]) => {
      setGroups(Array.isArray(g) ? g : [])
    })
  }, [])

  /* ---------- TOGGLE MEMBER ---------- */

  const toggleMember = (id: string) => {
    setNewMembers(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    )
  }

  /* ---------- CREATE ---------- */

  const create = () => {
    if (!newName.trim() || newMembers.length === 0) return

    const group: Group = {
      id: crypto.randomUUID(),
      name: newName.trim(),
      members: newMembers,
      channel: newChannel,
      color: newColor
    }

    socket.emit("group:create", group, () => {
      socket.emit("group:list", (g: Group[]) => setGroups(Array.isArray(g) ? g : []))
    })

    setNewName("")
    setNewMembers([])
    setNewChannel(1)
    setNewColor(GROUP_COLORS[0])
    setCreating(false)
  }

  /* ---------- DELETE ---------- */

  const deleteGroup = (id: string) => {
    socket.emit("group:delete", { id }, () => {
      setGroups(prev => prev.filter(g => g.id !== id))
    })
    setActiveGroups(prev => { prev.delete(id); return new Set(prev) })
  }

  /* ---------- PTT – PUSH TO TALK ---------- */

  const startPTT = (group: Group) => {
    if (!myId) return
    group.members.forEach(memberId => {
      if (memberId === myId) return
      socket.emit("connection:create", {
        from: myId,
        to: memberId,
        channel: group.channel,
        replace: false
      })
    })
  }

  const stopPTT = (group: Group) => {
    if (!myId) return
    // Only remove if not latched
    if (activeGroups.has(group.id)) return
    group.members.forEach(memberId => {
      if (memberId === myId) return
      socket.emit("connection:remove", {
        from: myId,
        to: memberId,
        channel: group.channel
      })
    })
  }

  /* ---------- LATCH ---------- */

  const toggleLatch = (group: Group) => {
    if (!myId) return
    const isActive = activeGroups.has(group.id)

    if (isActive) {
      // UNLATCH – remove connections
      group.members.forEach(memberId => {
        if (memberId === myId) return
        socket.emit("connection:remove", {
          from: myId,
          to: memberId,
          channel: group.channel
        })
      })
      setActiveGroups(prev => { prev.delete(group.id); return new Set(prev) })
    } else {
      // LATCH – create connections
      group.members.forEach(memberId => {
        if (memberId === myId) return
        socket.emit("connection:create", {
          from: myId,
          to: memberId,
          channel: group.channel,
          replace: false
        })
      })
      setActiveGroups(prev => new Set([...prev, group.id]))
    }
  }

  /* ---------- RENDER ---------- */

  return (
    <div className="h-full flex flex-col">

      <div className="flex items-center justify-between px-4 py-3 border-b border-white/5 shrink-0">
        <div className="flex items-center gap-2">
          <Users size={14} />
          <h2 className="text-sm font-bold">Grupper</h2>
          <span className="text-[10px] text-white/30">{groups.length} grupper</span>
        </div>
        <button
          onClick={() => setCreating(true)}
          className={`flex items-center gap-1 px-3 py-1.5 rounded text-xs font-bold bg-${themeColor}-600 hover:bg-${themeColor}-500 text-white`}
        >
          <Plus size={12} /> Ny gruppe
        </button>
      </div>

      <div className="flex-1 overflow-auto p-4 space-y-3">

        {/* CREATE FORM */}
        {creating && (
          <div className="bg-zinc-800 rounded-xl p-4 border border-white/10 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold">Ny gruppe</span>
              <button onClick={() => setCreating(false)} className="text-white/30 hover:text-white">
                <X size={14} />
              </button>
            </div>

            <input
              autoFocus
              value={newName}
              onChange={e => setNewName(e.target.value)}
              placeholder="Gruppenavn..."
              className="w-full px-3 py-2 bg-black border border-white/10 rounded text-xs text-white"
            />

            <div className="flex items-center gap-2">
              <span className="text-[10px] text-white/40 shrink-0">Kanal</span>
              <select
                value={newChannel}
                onChange={e => setNewChannel(Number(e.target.value))}
                className="flex-1 bg-black border border-white/10 rounded px-2 py-1.5 text-xs text-white"
              >
                {Array.from({ length: 8 }, (_, i) => (
                  <option key={i} value={i + 1}>Kanal {i + 1}</option>
                ))}
              </select>
            </div>

            <div>
              <p className="text-[10px] text-white/40 mb-2">Farve</p>
              <div className="flex gap-1">
                {GROUP_COLORS.map(c => (
                  <button
                    key={c}
                    onClick={() => setNewColor(c)}
                    className="w-6 h-6 rounded-full border-2 transition-transform hover:scale-110"
                    style={{ background: c, borderColor: newColor === c ? "white" : "transparent" }}
                  />
                ))}
              </div>
            </div>

            <div>
              <p className="text-[10px] text-white/40 mb-2">Medlemmer ({newMembers.length} valgt)</p>
              <div className="space-y-1 max-h-[160px] overflow-auto">
                {clients.map(c => (
                  <div
                    key={c.id}
                    onClick={() => toggleMember(c.id)}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded cursor-pointer text-xs transition-all
                      ${newMembers.includes(c.id)
                        ? "text-white border"
                        : "bg-white/5 hover:bg-white/10 text-white/60 border border-transparent"
                      }`}
                    style={newMembers.includes(c.id)
                      ? { background: newColor + "20", borderColor: newColor }
                      : {}}
                  >
                    <div
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ background: c.color || "#555" }}
                    />
                    {c.name}
                    {newMembers.includes(c.id) && (
                      <span className="ml-auto text-[9px] opacity-60">✓</span>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <button
              onClick={create}
              disabled={!newName.trim() || newMembers.length === 0}
              className={`w-full py-2 rounded text-xs font-bold transition-all
                ${newName.trim() && newMembers.length > 0
                  ? `bg-${themeColor}-600 hover:bg-${themeColor}-500 text-white`
                  : "bg-white/5 text-white/20 cursor-not-allowed"}`}
            >
              Opret gruppe med {newMembers.length} medlemmer
            </button>
          </div>
        )}

        {/* GROUP LIST */}
        {groups.length === 0 && !creating && (
          <div className="text-center py-12 text-white/20 text-sm">
            Ingen grupper endnu
          </div>
        )}

        {groups.map(group => {
          const isLatched = activeGroups.has(group.id)
          const memberNames = group.members
            .map(id => clients.find(c => c.id === id)?.name ?? id)
            .join(", ")

          return (
            <div
              key={group.id}
              className="rounded-xl border overflow-hidden"
              style={{ borderColor: group.color + "40" }}
            >

              {/* GROUP HEADER */}
              <div
                className="flex items-center justify-between px-3 py-2"
                style={{ background: group.color + "20" }}
              >
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full" style={{ background: group.color }} />
                  <span className="text-sm font-bold text-white">{group.name}</span>
                  <span
                    className="text-[9px] px-1.5 py-0.5 rounded font-bold"
                    style={{ background: group.color + "30", color: group.color }}
                  >
                    CH {group.channel}
                  </span>
                </div>
                <button
                  onClick={() => deleteGroup(group.id)}
                  className="p-1 rounded hover:bg-red-600/30 text-white/20 hover:text-red-400"
                >
                  <Trash2 size={11} />
                </button>
              </div>

              {/* MEMBERS */}
              <div className="px-3 py-2 bg-zinc-900">
                <p className="text-[10px] text-white/30 mb-1">
                  {group.members.length} medlemmer
                </p>
                <p className="text-[10px] text-white/50 truncate">{memberNames}</p>
              </div>

              {/* TALK CONTROLS */}
              <div className="flex gap-2 px-3 py-2 bg-zinc-900 border-t border-white/5">

                {/* PTT */}
                <button
                  onMouseDown={() => startPTT(group)}
                  onMouseUp={() => stopPTT(group)}
                  onMouseLeave={() => stopPTT(group)}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded text-xs font-bold transition-all
                    bg-zinc-800 hover:bg-zinc-700 active:scale-95"
                  style={{ borderLeft: `3px solid ${group.color}` }}
                  title="Hold for at tale til gruppen (push-to-talk)"
                >
                  <Mic size={13} /> PTT
                </button>

                {/* LATCH */}
                <button
                  onClick={() => toggleLatch(group)}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded text-xs font-bold transition-all"
                  style={isLatched
                    ? { background: group.color, color: "white" }
                    : { background: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.5)" }
                  }
                  title="Låst tale til gruppen (latch)"
                >
                  <Lock size={13} /> {isLatched ? "LÅST" : "LATCH"}
                </button>

              </div>

            </div>
          )
        })}

      </div>

    </div>
  )
}
