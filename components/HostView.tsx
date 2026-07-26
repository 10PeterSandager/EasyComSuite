import React, { useState, useEffect, useRef } from "react"
import { useDraggable } from "../hooks/useDraggable"
import RemotePanelView from "./RemotePanelView"
import ClientLinking from "./ClientLinking"
import { MappedClient, RemoteHost, RemotePanelNode } from "../types"

import ClientStrip, { FeedSource } from "./ClientStrip"
import ChannelMixer, { _mixerUpdateIfb } from "./ChannelMixer"
import ProducerStrip from "./ProducerStrip"
import NetworkPanel from "./NetworkPanel"
import VideoTab from "./VideoTab"
import ConnectionsPopup from "./ConnectionsPopup"
import RoutingOverview from "./RoutingOverview"
import SnapshotPanel from "./SnapshotPanel"
import ServerCapturePanel from "./ServerCapturePanel"
import GroupPanel from "./GroupPanel"
import GroupStrip, { Group as GroupType } from "./GroupStrip"
import SignalChainDebugger from "./SignalChainDebugger"

import { socket } from "../client/webrtc/intercom"
import { setChannelGain } from "../client/audio/AudioBridge"
import { subscribeBridge } from "../client/audio/audioBridgeStore"
import { ChannelMixerSettings, Client } from "../types"

import {
  Grid3X3, Plus, Search, Eye, EyeOff, Trash2,
  Keyboard, CheckSquare, Square, Smartphone,
  Monitor, Tablet, Video, Link2, Settings2,
  ZoomIn, ZoomOut, GitFork, Camera, Users, X,
  SlidersHorizontal, UserX
} from "lucide-react"

type ContextMenu = { clientId: string; x: number; y: number }
type SetupTab = "global" | "audio" | "network" | "documents" | "reset"

const CLIENT_TYPES = ["mobile", "desktop", "remote"] as const
const CLIENT_COLORS = [
  "#ef4444","#f97316","#eab308","#22c55e",
  "#06b6d4","#3b82f6","#a855f7","#ec4899",
  "#ffffff","#71717a"
]

const defaultMixer: ChannelMixerSettings = {
  gain: 80, mute: false, gateEnabled: false,
  gateThreshold: -50, eq: { low: 0, mid: 0, high: 0 }
}

const PRODUCER_ID = "producer-65"
const createProducerClient = (): Client => ({
  id: PRODUCER_ID, name: "BASE", type: "desktop",
  status: "online", code: "PROD", order: -1,
  hidden: false, color: "#f97316",
  isTalking: false, isLatched: false, isMuted: false,
  isIFBActive: false, isBacktalkActive: false,
  gain: 80, volume: 100, levels: [], micLevel: 0, auxLevel: 0,
  tbActive: [], muteOnTalk: [], openOnTalk: [],
  ifbNames: [], videoSources: [],
  receiveChannels: [1,2,3,4,5,6,7,8]
})

function DraggableMixer({ children }: { children: React.ReactNode }) {
  const { pos, onMouseDown } = useDraggable({ x: window.innerWidth - 420, y: 80 })
  return (
    <div className="fixed z-50 pointer-events-none" style={{ inset: 0 }}>
      <div className="pointer-events-auto absolute drop-shadow-2xl" style={{ left: pos.x, top: pos.y }}>
        <div
          className="cursor-grab active:cursor-grabbing select-none rounded-t-xl px-4 py-2 flex items-center gap-2"
          style={{ background: "linear-gradient(90deg,#1a1a1a,#222)", border: "1px solid rgba(255,255,255,0.1)", borderBottom: "none" }}
          onMouseDown={onMouseDown}>
          <span className="text-white/40 text-base leading-none">⠿</span>
          <span className="text-[10px] text-white/50 font-bold uppercase tracking-widest">Audio Mixer</span>
          <span className="text-[8px] text-white/20 ml-1">drag to move</span>
        </div>
        {children}
      </div>
    </div>
  )
}


function FactoryResetTab({ onReset }: { onReset: () => void }) {
  const [confirmed, setConfirmed] = React.useState(false)

  return (
    <div className="h-full flex flex-col items-center justify-center p-8 space-y-6">
      <div className="w-14 h-14 rounded-full bg-red-900/40 border border-red-500/40 flex items-center justify-center">
        <Trash2 size={24} className="text-red-400" />
      </div>
      <div className="text-center space-y-2 max-w-xs">
        <h2 className="text-sm font-black text-white uppercase tracking-widest">Factory Reset</h2>
        <p className="text-[10px] text-white/30 leading-relaxed">
          This will permanently delete all clients, routing connections, groups,
          audio routes and saved state. Network settings and host name are kept.
          The page will reload after reset.
        </p>
      </div>

      {!confirmed ? (
        <button
          onClick={() => setConfirmed(true)}
          className="px-6 py-2.5 bg-red-700/40 hover:bg-red-700/70 border border-red-500/40 rounded-xl text-xs font-black text-red-300 uppercase tracking-widest transition-colors">
          Reset to Factory Defaults
        </button>
      ) : (
        <div className="w-full max-w-xs space-y-3">
          <p className="text-xs font-black text-red-400 text-center uppercase tracking-wider">
            Are you sure? This cannot be undone.
          </p>
          <div className="flex gap-3">
            <button
              onClick={onReset}
              className="flex-1 py-2.5 bg-red-600 hover:bg-red-500 rounded-xl text-xs font-black text-white uppercase tracking-widest transition-colors">
              Yes, reset everything
            </button>
            <button
              onClick={() => setConfirmed(false)}
              className="flex-1 py-2.5 bg-white/10 hover:bg-white/20 rounded-xl text-xs font-black text-white uppercase tracking-widest transition-colors">
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

const HostView = (props: any) => {

  const {
    activeTab, setActiveTab,
    clients: rawClients = [],
    hardware = [],
    updateClient = () => {},
    deleteClients = () => {},
    updateMultipleClients = () => {},
    addClient = (count?: number, overrides?: any) => {},
    network, setNetwork = () => {},
    videoStream1, videoStream2, videoStream3, videoStream4,
    startVideoStream, stopVideoStream,
    onRoutingChange, onPreviewRefs,
    theme = "orange", myId
  } = props

  const themeColor = theme === "orange" ? "orange" : "blue"
  const [baseCollapsed, setBaseCollapsed] = React.useState(true)
  const [baseEditingName, setBaseEditingName] = React.useState(false)
  const [baseName, setBaseName] = React.useState("BASE")
  const [newClientCount, setNewClientCount] = React.useState(1)
  const [activeBridgeChannels, setActiveBridgeChannels] = React.useState<number[]>([])

  useEffect(() => {
    return subscribeBridge(state => {
      setActiveBridgeChannels(
        state.channels.filter(c => c.status === "active").map(c => c.channel)
      )
    })
  }, [])

  // REMOTE tab state
  const [clientTalkNames, setClientTalkNames] = React.useState<Record<string, Record<string, string>>>({})

  // Listen for talknames from mobile clients
  React.useEffect(() => {
    import('../client/webrtc/intercom').then(({ socket }) => {
      const handler = ({ clientId, names }: { clientId: string, names: Record<string, string> }) => {
        setClientTalkNames(prev => ({ ...prev, [clientId]: names }))
      }
      socket.on('client:talknames', handler)
      return () => { socket.off('client:talknames', handler) }
    })
  }, [])

  // 🎛️ Sync Stream Deck layout to server when panel mappings change
  const syncStreamDeck = React.useCallback((panelId: string, mappings: (any | null)[]) => {
    const layout = mappings.map(m => m ? {
      label: m.name ?? '',
      color: m.color ?? '#333333',
      active: false,
      clientId: m.isGroupLatch ? undefined : m.id,
      isGroup: !!m.isGroupLatch,
      groupMemberIds: m.memberIds
    } : null)
    socket.emit('streamdeck:layout', layout)
  }, [])
  const [remotePanels, setRemotePanels] = useState<RemotePanelNode[]>(() => {
    try { const s = localStorage.getItem('easycom:remotePanels'); return s ? JSON.parse(s) : [] } catch { return [] }
  })
  const [panelMappings, setPanelMappings] = useState<Record<string, (MappedClient | null)[]>>(() => {
    try { const s = localStorage.getItem('easycom:panelMappings'); return s ? JSON.parse(s) : {} } catch { return {} }
  })
  const [panelActiveKeys, setPanelActiveKeys] = useState<Record<string, boolean[]>>({})

  useEffect(() => {
    try { localStorage.setItem('easycom:remotePanels', JSON.stringify(remotePanels)) } catch {}
  }, [remotePanels])
  useEffect(() => {
    try { localStorage.setItem('easycom:panelMappings', JSON.stringify(panelMappings)) } catch {}
  }, [panelMappings])

  const producerExists = rawClients.some((c: Client) => c.id === PRODUCER_ID)
  const clients: Client[] = producerExists ? rawClients : [createProducerClient(), ...rawClients]
  const producerClient = clients.find((c: Client) => c.id === PRODUCER_ID) ?? createProducerClient()
  const regularClients = clients.filter((c: Client) => c.id !== PRODUCER_ID)

  const [searchTerm, setSearchTerm] = useState("")
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)
  const [lastSelectedId, setLastSelectedId] = useState<string | null>(null)
  const [mappingClientId, setMappingClientId] = useState<string | null>(null)
  const [popupClient, setPopupClient] = useState<any | null>(null)
  const [popupOpen, setPopupOpen] = useState(false)
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null)
  const [cardScale, setCardScale] = useState(2)
  const [setupTab, setSetupTab] = useState<SetupTab>("audio")
  const [connections, setConnections] = useState<any[]>([])
  const [editingNameId, setEditingNameId] = useState<string | null>(null)
  const [editingNameValue, setEditingNameValue] = useState("")
  const [mixerClientId, setMixerClientId] = useState<string | null>(null)
  const [showSignalDebug, setShowSignalDebug] = useState(false)
  const [showBulkPanel, setShowBulkPanel] = useState(false)
  const [bulkColor, setBulkColor] = useState("#71717a")

  // ── Roles ───────────────────────────────────────────────────────────────────
  const [roles, setRoles] = useState<{ id: string; label: string; color: string }[]>(() => {
    try { return JSON.parse(localStorage.getItem('easycom:roles') ?? '[]') } catch { return [] }
  })
  useEffect(() => {
    try { localStorage.setItem('easycom:roles', JSON.stringify(roles)) } catch {}
  }, [roles])

  // ── Groups ──────────────────────────────────────────────────────────────────
  const [groups, setGroups] = useState<GroupType[]>([])
  const [activeGroupIds, setActiveGroupIds] = useState<Set<string>>(new Set())
  const [showGroupCreate, setShowGroupCreate] = useState(false)
  const [newGroupName, setNewGroupName] = useState("")
  const [newGroupColor, setNewGroupColor] = useState("#3b82f6")
  const GROUP_COLORS_HV = ["#ef4444","#f97316","#eab308","#22c55e","#06b6d4","#3b82f6","#a855f7","#ec4899"]

  useEffect(() => {
    socket.emit("group:list", (g: GroupType[]) => setGroups(Array.isArray(g) ? g : []))
  }, [])

  const createGroupFromSelection = () => {
    if (!newGroupName.trim() || selectedIds.length < 2) return
    const group: GroupType = {
      id: crypto.randomUUID(),
      name: newGroupName.trim(),
      members: selectedIds,
      channel: 1,
      color: newGroupColor
    }
    socket.emit("group:create", group, () => {
      socket.emit("group:list", (g: GroupType[]) => setGroups(Array.isArray(g) ? g : []))
    })
    setGroups(prev => [...prev, group])
    setNewGroupName("")
    setShowGroupCreate(false)
    setSelectedIds([])
  }

  const activateGroup = (group: GroupType) => {
    const pairs: [string, string][] = []
    for (let i = 0; i < group.members.length; i++) {
      for (let j = i + 1; j < group.members.length; j++) {
        pairs.push([group.members[i], group.members[j]])
      }
    }
    pairs.forEach(([a, b]) => {
      socket.emit("connection:create", { from: a, to: b, channel: group.channel, bidirectional: true })
    })
    setActiveGroupIds(prev => new Set([...prev, group.id]))
  }

  const deactivateGroup = (group: GroupType) => {
    const pairs: [string, string][] = []
    for (let i = 0; i < group.members.length; i++) {
      for (let j = i + 1; j < group.members.length; j++) {
        pairs.push([group.members[i], group.members[j]])
      }
    }
    pairs.forEach(([a, b]) => {
      socket.emit("connection:remove", { from: a, to: b, channel: group.channel })
      socket.emit("connection:remove", { from: b, to: a, channel: group.channel })
    })
    setActiveGroupIds(prev => { const s = new Set(prev); s.delete(group.id); return s })
  }

  const updateGroup = (g: GroupType) => {
    socket.emit("group:create", g)
    setGroups(prev => prev.map(x => x.id === g.id ? g : x))
  }

  const deleteGroup = (id: string) => {
    const g = groups.find(x => x.id === id)
    if (g && activeGroupIds.has(id)) deactivateGroup(g)
    socket.emit("group:delete", { id })
    setGroups(prev => prev.filter(x => x.id !== id))
    setActiveGroupIds(prev => { const s = new Set(prev); s.delete(id); return s })
  }

  // Drag-to-reorder
  const [gridOrder, setGridOrder] = useState<string[]>([])
  const dragItem = useRef<string | null>(null)
  const dragOverItem = useRef<string | null>(null)
  const contextMenuRef = useRef<HTMLDivElement>(null)

  /* ---------- GRID ORDER ---------- */

  useEffect(() => {
    setGridOrder(prev => {
      const clientIds = regularClients.map((c: Client) => c.id)
      const groupIds = groups.map(g => `group-${g.id}`)
      const allIds = [...clientIds, ...groupIds]
      const existing = prev.filter(id => allIds.includes(id))
      const added = allIds.filter(id => !prev.includes(id))
      return [...existing, ...added]
    })
  }, [regularClients.length, groups.length])

  const orderedRegularClients = gridOrder
    .map(id => regularClients.find((c: Client) => c.id === id))
    .filter(Boolean) as Client[]

  const handleGridDragStart = (id: string) => { dragItem.current = id }
  const handleGridDragEnter = (id: string) => { dragOverItem.current = id }
  const handleGridDragEnd = () => {
    if (!dragItem.current || !dragOverItem.current || dragItem.current === dragOverItem.current) {
      dragItem.current = null; dragOverItem.current = null; return
    }
    const newOrder = [...gridOrder]
    const from = newOrder.indexOf(dragItem.current)
    const to = newOrder.indexOf(dragOverItem.current)
    newOrder.splice(from, 1)
    newOrder.splice(to, 0, dragItem.current)
    setGridOrder(newOrder)
    dragItem.current = null; dragOverItem.current = null
  }

  /* ---------- CONNECTIONS ---------- */

  useEffect(() => {
    const load = (list?: any[]) => {
      if (Array.isArray(list)) { setConnections(list); return }
      socket.emit("connections:list", (res: any[]) => setConnections(Array.isArray(res) ? res : []))
    }
    load()
    socket.on("routing:update", load)
    return () => { socket.off("routing:update", load) }
  }, [])

  // 🔥 Update mixer when mobile client changes gain
  useEffect(() => {
    const handler = ({ clientId, channel, gain }: { clientId: string; channel: number; gain: number }) => {
      console.log(`[client:gain] clientId=${clientId} ch=${channel} gain=${Math.round(gain*100)}% fn=${!!_mixerUpdateIfb.fn} connections=${connections.length}`)
      // 1. Update mixer UI if open
      _mixerUpdateIfb.fn?.(channel - 1, { gain: Math.round(gain * 100) })
      // 2. Apply gain directly via connections – works even when mixer is closed
      const conn = connections.find(c => c.to === clientId && c.channel === channel)
      console.log(`[client:gain] conn found:`, conn)
      if (conn?.from) {
        const match = conn.from.match(/bridge-ch(\d+)/)
        if (match) {
          setChannelGain(parseInt(match[1]), gain)
          console.log(`[gain] mobile ch${channel} → bridge-ch${match[1]}: ${Math.round(gain*100)}%`)
        }
      }
    }
    socket.on("client:gain", handler)
    return () => { socket.off("client:gain", handler) }
  }, [connections])

  const handleUpdateClient = (id: string, updates: any) => {
    if (selectedIds.length > 1) {
      selectedIds.forEach(sid => updateClient(sid, updates))
      if (!selectedIds.includes(id)) updateClient(id, updates)
    } else {
      updateClient(id, updates)
    }
  }

  const toggleMixer = (clientId: string) => setMixerClientId(prev => prev === clientId ? null : clientId)
  const mixerClient = clients.find((c: Client) => c.id === mixerClientId)
  const handleMixerChange = (s: ChannelMixerSettings) => {
    if (!mixerClientId) return
    updateClient(mixerClientId, { channelMixer: { ...(mixerClient?.channelMixer ?? {}), 1: s } })
  }

  const handleRestoreSnapshot = (snapshot: any) => {
    if (!window.confirm(`Gendan snapshot "${snapshot.name}"?`)) return
    snapshot.clients.forEach((c: any) => updateClient(c.id, c))
    snapshot.connections.forEach((c: any) => socket.emit("connection:create", { ...c, replace: true }))
  }

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) setContextMenu(null)
    }
    window.addEventListener("mousedown", handler)
    return () => window.removeEventListener("mousedown", handler)
  }, [])

  useEffect(() => {
    if (!mappingClientId) return
    const captureKey = (e: KeyboardEvent) => {
      e.preventDefault()
      updateClient(mappingClientId, { keyTrigger: e.code })
      setMappingClientId(null)
    }
    window.addEventListener("keydown", captureKey, true)
    return () => window.removeEventListener("keydown", captureKey, true)
  }, [mappingClientId])

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const c = clients.find((x: Client) => x.keyTrigger === e.code)
      if (c) updateClient(c.id, { isTalking: true })
    }
    const up = (e: KeyboardEvent) => {
      const c = clients.find((x: Client) => x.keyTrigger === e.code)
      if (c) updateClient(c.id, { isTalking: false })
    }
    window.addEventListener("keydown", down)
    window.addEventListener("keyup", up)
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up) }
  }, [clients])

  const handleClientSelect = (id: string, e: React.MouseEvent) => {
    if (editingNameId) return
    const filtered = regularClients.filter((c: Client) => c.name.toLowerCase().includes(searchTerm.toLowerCase()))
    const currentIdx = filtered.findIndex((c: Client) => c.id === id)
    if (e.shiftKey && lastSelectedId) {
      const lastIdx = filtered.findIndex((c: Client) => c.id === lastSelectedId)
      const [s, en] = [Math.min(lastIdx, currentIdx), Math.max(lastIdx, currentIdx)]
      setSelectedIds(filtered.slice(s, en + 1).map((c: Client) => c.id))
    } else if (e.ctrlKey || e.metaKey) {
      setSelectedIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id])
    } else {
      setSelectedIds([id])
    }
    setLastSelectedId(id)
  }

  const filteredClients = regularClients.filter((c: Client) => c.name.toLowerCase().includes(searchTerm.toLowerCase()))
  const allSelected = filteredClients.length > 0 && filteredClients.every((c: Client) => selectedIds.includes(c.id))
  const toggleSelectAll = () => {
    if (allSelected) setSelectedIds([])
    else setSelectedIds(filteredClients.map((c: Client) => c.id))
  }

  const handleRightClick = (e: React.MouseEvent, clientId: string) => {
    e.preventDefault(); e.stopPropagation()
    const x = Math.max(8, Math.min(e.clientX, window.innerWidth - 220))
    const y = Math.max(8, Math.min(e.clientY, window.innerHeight - 320))
    setContextMenu({ clientId, x, y })
  }

  const scaleUp = () => setCardScale(s => Math.min(2, parseFloat((s + 0.1).toFixed(1))))
  const scaleDown = () => setCardScale(s => Math.max(0.4, parseFloat((s - 0.1).toFixed(1))))

  const startRename = (c: any, e: React.MouseEvent) => {
    e.stopPropagation(); setEditingNameId(c.id); setEditingNameValue(c.name)
  }
  const saveRename = (id: string) => {
    if (editingNameValue.trim()) updateClient(id, { name: editingNameValue.trim() })
    setEditingNameId(null)
  }

  /* ---------- TABS ---------- */

  const renderTab = () => {
    switch (activeTab) {

      case "grid":
        return (
          <div className="relative w-full h-full overflow-auto p-3 pt-0">


            {/* TOOLBAR */}
            <div className="flex items-center gap-2 mb-3 flex-wrap">
              <button onClick={scaleDown} className="p-1 bg-white/5 hover:bg-white/10 rounded">
                <ZoomOut size={14} />
              </button>
              <div className="w-24 h-1.5 bg-white/10 rounded overflow-hidden">
                <div className="h-full bg-zinc-400 rounded transition-all"
                  style={{ width: `${((cardScale - 0.4) / 1.6) * 100}%` }} />
              </div>
              <button onClick={scaleUp} className="p-1 bg-white/5 hover:bg-white/10 rounded">
                <ZoomIn size={14} />
              </button>
              <span className="text-[10px] text-white/30">{Math.round(cardScale * 100)}%</span>

              {/* Signal debug removed */}

              {selectedIds.length > 1 && (
                <span className={`ml-1 text-[10px] px-2 py-0.5 rounded bg-${themeColor}-600/30 text-${themeColor}-400`}>
                  ✏️ {selectedIds.length} selected
                </span>
              )}

              {selectedIds.length >= 2 && (
                <button
                  onClick={() => { setShowGroupCreate(p => !p); setNewGroupName("") }}
                  className="ml-1 flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold"
                  style={{ background: showGroupCreate ? "#3b82f620" : "rgba(255,255,255,0.08)", border: "1px solid #3b82f640", color: "#3b82f6" }}
                >
                  <Users size={10} /> CREATE GROUP
                </button>
              )}

              <span className="text-[10px] text-white/15 ml-1">Drag cards to reorder</span>
            </div>

            {/* INLINE GROUP CREATE FORM */}
            {showGroupCreate && selectedIds.length >= 2 && (
              <div className="flex items-center gap-2 mb-3 p-2 rounded-xl"
                style={{ background: "rgba(59,130,246,0.08)", border: "1px solid #3b82f630" }}>
                <input
                  autoFocus
                  value={newGroupName}
                  onChange={e => setNewGroupName(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") createGroupFromSelection() }}
                  placeholder={`Group name (${selectedIds.length} members)...`}
                  className="flex-1 bg-black border border-white/10 rounded px-2 py-1 text-xs text-white"
                />
                <div className="flex gap-1">
                  {GROUP_COLORS_HV.map(c => (
                    <button key={c} onClick={() => setNewGroupColor(c)}
                      className="w-4 h-4 rounded-full border-2 transition-transform hover:scale-110"
                      style={{ background: c, borderColor: newGroupColor === c ? "#fff" : "transparent" }} />
                  ))}
                </div>
                <button
                  onClick={createGroupFromSelection}
                  disabled={!newGroupName.trim()}
                  className="px-3 py-1 rounded text-xs font-bold"
                  style={{ background: newGroupName.trim() ? "#3b82f6" : "rgba(255,255,255,0.08)", color: "#fff" }}
                >
                  Create
                </button>
                <button onClick={() => setShowGroupCreate(false)} className="text-white/30 hover:text-white">
                  <X size={14} />
                </button>
              </div>
            )}

            {/* CLIENT GRID */}
            <div
              className="grid gap-2"
              style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${Math.round(92 * cardScale)}px, ${Math.round(92 * cardScale)}px))` }}
              onClick={e => { if (e.target === e.currentTarget) setSelectedIds([]) }}
            >
              {gridOrder.map(id => {
                if (id.startsWith('group-')) {
                  const gid = id.slice(6)
                  const g = groups.find(x => x.id === gid)
                  if (!g) return null
                  return (
                    <div
                      key={id}
                      draggable
                      onDragStart={() => handleGridDragStart(id)}
                      onDragEnter={() => handleGridDragEnter(id)}
                      onDragEnd={handleGridDragEnd}
                      onDragOver={e => e.preventDefault()}
                      style={{ width: `${Math.round(92 * cardScale)}px`, cursor: "grab" }}
                      className="active:cursor-grabbing"
                    >
                      <GroupStrip
                        group={g}
                        clients={[producerClient, ...regularClients]}
                        isActive={activeGroupIds.has(g.id)}
                        onActivate={() => activateGroup(g)}
                        onDeactivate={() => deactivateGroup(g)}
                        onDelete={() => deleteGroup(g.id)}
                        onUpdate={updateGroup}
                      />
                    </div>
                  )
                }
                const c = regularClients.find((x: Client) => x.id === id)
                if (!c || c.hidden) return null
                const bridgeSources: FeedSource[] = activeBridgeChannels.map(ch => ({
                  id: `bridge-ch${ch}`,
                  label: `Bridge CH${ch}`
                }))
                const clientSources: FeedSource[] = regularClients
                  .filter((x: Client) => x.id !== c.id && x.status === "online")
                  .map((x: Client) => ({ id: x.id, label: x.name }))
                const feedSources: FeedSource[] = [...clientSources, ...bridgeSources]
                return (
                  <div
                    key={c.id}
                    draggable
                    onDragStart={() => handleGridDragStart(c.id)}
                    onDragEnter={() => handleGridDragEnter(c.id)}
                    onDragEnd={handleGridDragEnd}
                    onDragOver={e => e.preventDefault()}
                    onClick={e => handleClientSelect(c.id, e)}
                    onContextMenu={e => handleRightClick(e, c.id)}
                    style={{ width: `${Math.round(92 * cardScale)}px`, cursor: "grab" }}
                    className="active:cursor-grabbing"
                  >
                    <ClientStrip
                      client={c}
                      isSelected={selectedIds.includes(c.id)}
                      onUpdate={(u: any) => handleUpdateClient(c.id, u)}
                      onHijack={() => {}}
                      onMapKey={() => setMappingClientId(c.id)}
                      theme={theme}
                      isMixerOpen={mixerClientId === c.id}
                      onToggleMixer={() => toggleMixer(c.id)}
                      feedSources={feedSources}
                      allClients={regularClients}
                      roles={roles}
                    />
                  </div>
                )
              })}
            </div>

            {/* FLOATING MIXER */}
            {mixerClient && (
              <DraggableMixer>
                <ChannelMixer
                  channel={1}
                  clientId={mixerClient.id}
                  clientName={mixerClient.name}
                  settings={mixerClient.channelMixer?.[1] ?? defaultMixer}
                  onChange={handleMixerChange}
                  onClose={() => setMixerClientId(null)}
                  theme={theme}
                  connections={connections}
                />
              </DraggableMixer>
            )}

          </div>
        )

      case "routing":
        return <RoutingOverview clients={clients} theme={theme} />

      case "groups":
        return <GroupPanel clients={regularClients} theme={theme} myId={myId} />

      case "linking":
        return (
          <ClientLinking
            clients={regularClients}
            updateClient={updateClient}
            remoteHosts={props.remoteHosts || []}
            theme={theme}
          />
        )

      case "snapshots":
        return (
          <SnapshotPanel
            clients={clients}
            connections={connections}
            onRestore={handleRestoreSnapshot}
            theme={theme}
          />
        )

      case "video":
        return (
          <VideoTab
            clients={regularClients} updateClient={updateClient}
            videoStream1={videoStream1} videoStream2={videoStream2}
            videoStream3={videoStream3} videoStream4={videoStream4}
            startVideoStream={startVideoStream} stopVideoStream={stopVideoStream}
            selectedIds={selectedIds} updateMultipleClients={updateMultipleClients}
            onClientMark={(id: any, e: any) => handleClientSelect(id, e)}
            onRoutingChange={onRoutingChange}
            theme={theme}
          />
        )

      case "setup":
        return (
          <div className="h-full flex flex-col">
            {/* Tab switcher */}
            <div className="flex items-center px-4 pt-3 pb-0 shrink-0 border-b border-white/5 overflow-x-auto">
              <div className="flex gap-1 shrink-0">
                {([
                  { id: "audio",     label: "Audio I/O" },
                  { id: "network",   label: "Network" },
                  { id: "documents", label: "Documents" },
                  { id: "global",    label: "Global Setup" },
                  { id: "reset",     label: "Reset" },
                ] as const).map(t => (
                  <button key={t.id} onClick={() => setSetupTab(t.id)}
                    className={`px-3 py-1.5 text-xs font-bold whitespace-nowrap transition-colors
                      ${setupTab === t.id
                        ? t.id === "reset"
                          ? "border-b-2 border-red-500 text-red-400"
                          : `border-b-2 border-${themeColor}-500 text-${themeColor}-300`
                        : "text-white/40 hover:text-white/70"}`}>
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex-1 overflow-hidden">
              {setupTab === "global" ? (
                <GlobalSetupTab
                  clients={clients}
                  themeColor={themeColor}
                  roles={roles}
                  onRolesChange={setRoles}
                  onApplyIFBToAll={(settings) => {
                    clients.filter(c => c.id !== PRODUCER_ID).forEach(c => {
                      const s = { ...settings }
                      updateClient(c.id, { ifbSettings: s } as any)
                      socket.emit("ifb:settings:update", { clientId: c.id, settings: s })
                    })
                  }}
                />
              ) : setupTab === "network" ? (
                <div className="h-full flex flex-col overflow-y-auto">
                  {/* Host Identity */}
                  <div className="px-4 pt-3 pb-3 border-b border-white/5 shrink-0">
                    <p className="text-[10px] text-white/40 uppercase tracking-widest font-bold mb-2">Host Identity</p>
                    <div className="flex items-center gap-2">
                      <label className="text-[10px] text-white/50 shrink-0">Host name</label>
                      <input
                        value={props.hostName ?? "EASYCOM-HOST"}
                        onChange={e => props.setHostName?.(e.target.value.toUpperCase())}
                        className="flex-1 bg-black border border-white/10 rounded px-2 py-1 text-xs text-white font-black uppercase tracking-widest"
                        placeholder="EASYCOM-HOST"
                        maxLength={24}
                      />
                    </div>
                    <p className="text-[9px] text-white/20 mt-1">This name is used by other hosts to find this station on the network.</p>
                  </div>
                  {/* Stream Deck Network */}
                  <div className="px-4 pt-3 pb-3 border-b border-white/5 shrink-0">
                    <p className="text-[10px] text-white/40 uppercase tracking-widest font-bold mb-2">Stream Deck Studio</p>
                    <div className="flex items-center gap-2">
                      <label className="text-[10px] text-white/50 shrink-0">IP address</label>
                      <input
                        id="streamdeck-ip"
                        defaultValue={localStorage.getItem('easycom_streamdeck_ip') ?? ''}
                        onChange={e => localStorage.setItem('easycom_streamdeck_ip', e.target.value)}
                        className="flex-1 bg-black border border-white/10 rounded px-2 py-1 text-xs text-white font-mono"
                        placeholder="192.168.1.x"
                      />
                      <button
                        onClick={() => {
                          const ip = (document.getElementById('streamdeck-ip') as HTMLInputElement)?.value
                          if (ip) {
                            socket.emit('streamdeck:connect:network', { host: ip, port: 5343 })
                          }
                        }}
                        className="px-2 py-1 rounded text-[9px] font-black text-white uppercase"
                        style={{ background: '#f97316' }}>
                        Connect
                      </button>
                    </div>
                    <p className="text-[9px] text-white/20 mt-1">Stream Deck Studio connects directly via TCP port 5343 – no relay needed.</p>
                  </div>
                  {/* SSL cert (only non-redundant part of old Server tab) */}
                  <SSLConfigSection themeColor={themeColor} />
                  {/* Network Panel */}
                  <div className="flex-1 overflow-hidden">
                    <NetworkPanel
                      network={network} setNetwork={setNetwork}
                      remoteHosts={props.remoteHosts || []}
                      hardware={hardware}
                      refreshHardware={props.refreshHardware}
                      forceResumeAudio={props.forceResumeAudio}
                      globalInputLevel={props.globalInputLevel}
                    />
                  </div>
                </div>
              ) : setupTab === "documents" ? (
                <DocumentsTab />
              ) : setupTab === "reset" ? (
                <FactoryResetTab
                  onReset={() => {
                    socket.emit("server:factory:reset", () => {})
                    const keysToKeep = ['easycom_hostname', 'easycom_streamdeck_ip']
                    Object.keys(localStorage)
                      .filter(k => k.startsWith('easycom') && !keysToKeep.includes(k))
                      .forEach(k => localStorage.removeItem(k))
                    props.deleteClients?.(props.rawClients?.map((c: any) => c.id) ?? [])
                    window.location.reload()
                  }}
                />
              ) : (
                <ServerCapturePanel />
              )}
            </div>
          </div>
        )

      case "remote":
        return (
          <RemotePanelView
            clients={regularClients}
            allClients={regularClients}
            updateClient={updateClient}
            remoteHosts={props.remoteHosts || []}
            panelMappings={panelMappings}
            setPanelMappings={setPanelMappings}
            theme={theme}
            sharedStream1={null}
            sharedStream2={null}
            remotePanels={remotePanels}
            setRemotePanels={setRemotePanels}
            panelActiveKeys={panelActiveKeys}
            setPanelActiveKeys={setPanelActiveKeys}
            roles={roles}
          />
        )

      default: return null
    }
  }

  /* ---------- RENDER ---------- */

  return (
    <div className="h-full flex overflow-hidden">

      {/* SIDEBAR */}
      <div className="w-[260px] shrink-0 bg-zinc-950 border-r border-white/5 flex flex-col">

        <div className="p-3 border-b border-white/5 space-y-2">
          {/* NEW CLIENT – multi-create */}
          <div className="flex gap-1 items-center">
            <button onClick={() => addClient(newClientCount)}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 bg-${themeColor}-600 text-white font-black rounded text-sm`}>
              <Plus size={13} /> NEW CLIENT
            </button>
            <div className="flex flex-col items-center gap-0.5">
              <input
                type="number" min={1} max={64 - regularClients.length} value={newClientCount}
                onChange={e => setNewClientCount(Math.max(1, Math.min(64 - regularClients.length, parseInt(e.target.value) || 1)))}
                onKeyDown={e => { if (e.key === 'Enter') addClient(newClientCount) }}
                className="w-12 text-center text-xs bg-zinc-900 border border-white/10 rounded py-1 text-white"
              />
              <span className="text-[8px] text-white/25">{64 - regularClients.length} left</span>
            </div>
          </div>
          <div className="relative">
            <Search size={12} className="absolute left-2 top-2" />
            <input value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
              placeholder="Search clients"
              className="w-full pl-6 p-2 bg-black border border-white/10 rounded text-xs" />
          </div>
          <div className="flex gap-2">
            <button onClick={toggleSelectAll}
              className="flex-1 flex items-center justify-center gap-1 py-1 text-xs bg-white/5 hover:bg-white/10 rounded">
              {allSelected ? <><CheckSquare size={12} /> Deselect all</> : <><Square size={12} /> Select all</>}
            </button>
            {selectedIds.length > 0 && (
              <button onClick={() => setConfirmDeleteOpen(true)}
                className="px-2 py-1 text-xs bg-red-600/20 hover:bg-red-600/40 text-red-400 rounded">
                <Trash2 size={12} />
              </button>
            )}
          </div>
        </div>

        {/* ── Delete confirmation ─────────────────────────────────────── */}
        {confirmDeleteOpen && (
          <div className="mx-3 mt-2 p-3 rounded-xl bg-red-950/60 border border-red-500/40 space-y-2">
            <p className="text-xs font-black text-red-300 uppercase tracking-wider text-center">
              {selectedIds.length === 1
                ? 'Are you sure you want to delete this client?'
                : `Are you sure you want to delete these ${selectedIds.length} clients?`}
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  deleteClients(selectedIds)
                  setSelectedIds([])
                  setConfirmDeleteOpen(false)
                }}
                className="flex-1 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-white text-xs font-black uppercase tracking-widest transition-colors">
                Yes, delete
              </button>
              <button
                onClick={() => setConfirmDeleteOpen(false)}
                className="flex-1 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white text-xs font-black uppercase tracking-widest transition-colors">
                Cancel
              </button>
            </div>
          </div>
        )}

        {mappingClientId && (
          <div className={`mx-3 mt-2 px-3 py-2 rounded text-xs text-center bg-${themeColor}-600/30 border border-${themeColor}-500/50 animate-pulse`}>
            🎹 Press a key...
            <button className="ml-2 text-white/50 hover:text-white" onClick={() => setMappingClientId(null)}>✕</button>
          </div>
        )}

        {selectedIds.length > 1 && (
          <div className={`mx-3 mt-2 px-3 py-2 rounded text-xs text-center bg-${themeColor}-900/40 border border-${themeColor}-700/40`}>
            ✏️ {selectedIds.length} clients selected
          </div>
        )}

        <div className="flex-1 overflow-auto p-2 space-y-1"
          onClick={e => { if (e.target === e.currentTarget) setSelectedIds([]) }}>

          {/* PRODUCER row */}
          <div className="flex items-center justify-between px-3 py-2 rounded mb-1"
            style={{
              background: `${themeColor === "orange" ? "#f97316" : "#3b82f6"}15`,
              border: `1px solid ${themeColor === "orange" ? "#f97316" : "#3b82f6"}30`
            }}>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full"
                style={{ background: themeColor === "orange" ? "#f97316" : "#3b82f6" }} />
              <span className="text-xs font-black text-white">BASE</span>
              <span className="text-[8px] text-white/30">CL 65</span>
            </div>
            <button onClick={e => { e.stopPropagation(); setPopupClient(producerClient); setPopupOpen(true) }}>
              <Link2 size={12} className="text-white/30 hover:text-white" />
            </button>
          </div>

          {filteredClients.map((c: Client) => {
            const isSelected = selectedIds.includes(c.id)
            const isRenaming = editingNameId === c.id
            return (
              <div key={c.id}
                className={`flex items-center justify-between px-3 py-2 rounded cursor-pointer
                  ${isSelected
                    ? `bg-${themeColor}-600/20 border border-${themeColor}-500/40`
                    : "bg-white/5 hover:bg-white/10"}`}
                onClick={e => handleClientSelect(c.id, e)}
                onContextMenu={e => handleRightClick(e, c.id)}
              >
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  {isSelected
                    ? <CheckSquare size={14} className={`text-${themeColor}-500 shrink-0`} />
                    : <Square size={14} className="shrink-0" />}
                  {c.type === "mobile" && <Smartphone size={12} className="shrink-0" />}
                  {c.type === "desktop" && <Monitor size={12} className="shrink-0" />}
                  {c.type === "remote" && <Tablet size={12} className="shrink-0" />}
                  {(!c.type || (c.type as string) === "") && <span className="text-[7px] text-white/20 shrink-0 italic">unset</span>}
                  {c.color && <span className="w-2 h-2 rounded-full shrink-0" style={{ background: c.color }} />}
                  {isRenaming ? (
                    <input autoFocus value={editingNameValue}
                      onChange={e => setEditingNameValue(e.target.value)}
                      onBlur={() => saveRename(c.id)}
                      onKeyDown={e => {
                        if (e.key === "Enter") saveRename(c.id)
                        if (e.key === "Escape") setEditingNameId(null)
                      }}
                      onClick={e => e.stopPropagation()}
                      className="flex-1 min-w-0 text-xs bg-black border border-white/20 rounded px-1 py-0.5"
                    />
                  ) : (
                    <span className="text-xs font-bold truncate flex-1"
                      onDoubleClick={e => startRename(c, e)}>
                      {c.name}
                    </span>
                  )}
                </div>
                <div className="flex gap-1 shrink-0">
                  <button
                    onClick={e => { e.stopPropagation(); setMappingClientId(c.id) }}
                    className={`hover:text-yellow-400 ${c.keyTrigger ? "text-green-500" : ""}`}>
                    <Keyboard size={12} />
                  </button>
                  <button onClick={e => { e.stopPropagation(); updateClient(c.id, { hidden: !c.hidden }) }}>
                    {c.hidden ? <EyeOff size={12} /> : <Eye size={12} />}
                  </button>
                  <button onClick={e => { e.stopPropagation(); deleteClients([c.id]) }}>
                    <Trash2 size={12} />
                  </button>
                  <button onClick={e => { e.stopPropagation(); setPopupClient(c); setPopupOpen(true) }}>
                    <Link2 size={12} />
                  </button>
                </div>
              </div>
            )
          })}

          {groups.length > 0 && (
            <>
              <div className="px-3 pt-3 pb-1 text-[9px] font-black uppercase tracking-widest text-white/30">Groups</div>
              {groups.map(g => (
                <div key={g.id} className="flex items-center justify-between px-3 py-2 rounded bg-white/5 hover:bg-white/10 cursor-pointer"
                  onClick={() => activeGroupIds.has(g.id) ? deactivateGroup(g) : activateGroup(g)}>
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ background: g.color ?? '#3b82f6' }} />
                    <span className="text-xs font-bold truncate">{g.name}</span>
                    <span className="text-[9px] text-white/30">{g.members.length}p</span>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <span className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded ${activeGroupIds.has(g.id) ? 'bg-green-500/20 text-green-400' : 'bg-white/5 text-white/30'}`}>
                      {activeGroupIds.has(g.id) ? 'ON' : 'OFF'}
                    </span>
                    <button onClick={e => { e.stopPropagation(); deleteGroup(g.id) }} className="text-white/20 hover:text-red-400">
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      </div>

      {/* MAIN */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className="h-14 flex items-center gap-1 border-b border-white/5 px-4 shrink-0 overflow-x-auto">
          {[
            { id: "grid",      icon: <Grid3X3 size={13} />,   label: "GRID" },
            { id: "routing",   icon: <GitFork size={13} />,   label: "ROUTING" },
            { id: "linking",   icon: <Link2 size={13} />,     label: "LINK" },
            { id: "remote",    icon: <Monitor size={13} />,   label: "REMOTE" },
            { id: "snapshots", icon: <Camera size={13} />,    label: "SNAPSHOTS" },
            { id: "video",     icon: <Video size={13} />,     label: "VIDEO" },
            { id: "setup",     icon: <Settings2 size={13} />, label: "SETUP" },
          ].map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-bold transition-colors whitespace-nowrap
                ${activeTab === tab.id
                  ? `bg-${themeColor}-600/20 text-${themeColor}-300 border border-${themeColor}-500/30`
                  : "text-white/40 hover:text-white/70 hover:bg-white/5"}`}>
              {tab.icon} {tab.label}
            </button>
          ))}
        </div>
        {/* BASE section always mounted so ProducerStrip mediasoup init runs on every tab */}
        <div style={{ display: activeTab === 'grid' ? undefined : 'none' }} className="px-3 pt-3">
          <div className="mb-3 rounded-xl overflow-hidden border border-white/10">
            <div
              className="flex items-center justify-between px-3 py-2 cursor-pointer select-none"
              style={{ background: "rgba(255,255,255,0.04)" }}
              onClick={() => setBaseCollapsed(c => !c)}
            >
              <div className="flex items-center gap-2">
                <span className="text-[9px] text-white/30">{baseCollapsed ? '▶' : '▼'}</span>
                {baseEditingName ? (
                  <input
                    autoFocus
                    value={baseName}
                    onChange={e => setBaseName(e.target.value)}
                    onBlur={() => { setBaseEditingName(false); updateClient(PRODUCER_ID, { name: baseName }) }}
                    onKeyDown={e => { if (e.key === 'Enter') { setBaseEditingName(false); updateClient(PRODUCER_ID, { name: baseName }) } }}
                    onClick={e => e.stopPropagation()}
                    className="text-xs font-black text-white bg-transparent border-b border-white/30 outline-none w-32"
                  />
                ) : (
                  <span
                    className="text-xs font-black text-white"
                    onDoubleClick={e => { e.stopPropagation(); setBaseEditingName(true) }}
                  >{baseName}</span>
                )}
              </div>
              <span className="text-[9px] text-white/20">double-click to rename</span>
            </div>
            {/* ProducerStrip always rendered (use CSS hide when collapsed) so mediasoup stays alive */}
            <div style={{ display: baseCollapsed ? 'none' : undefined }}>
              <ProducerStrip
                client={producerClient}
                clients={regularClients}
                onUpdate={(u: any) => updateClient(PRODUCER_ID, u)}
                theme={theme}
              />
            </div>
          </div>
        </div>
        <div className="flex-1 overflow-hidden min-w-0">{renderTab()}</div>
      </div>

      {/* CONNECTIONS POPUP — kept mounted so connections state survives close/reopen */}
      {popupClient && (
        <ConnectionsPopup
          open={popupOpen}
          onClose={() => setPopupOpen(false)}
          sourceClient={popupClient}
          clients={clients}
          onUpdateClient={updateClient}
          clientTalkNames={clientTalkNames[popupClient.id] || {}}
        />
      )}

      {/* SIGNAL CHAIN DEBUGGER */}
      {showSignalDebug && (
        <SignalChainDebugger onClose={() => setShowSignalDebug(false)} />
      )}

      {/* CONTEXT MENU */}
      {/* BULK SELECTION PANEL – skjult i video-tab */}
      {selectedIds.length > 1 && activeTab !== "video" && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 rounded-2xl shadow-2xl flex items-center gap-2 px-4 py-3"
          style={{ background: "#1a1a1a", border: "1px solid rgba(255,255,255,0.15)" }}>
          <span className="text-xs font-bold text-white/60 mr-2">{selectedIds.length} selected</span>

          {/* Farve */}
          <div className="flex gap-1 items-center border-r border-white/10 pr-3 mr-1">
            {CLIENT_COLORS.map(color => (
              <button key={color}
                onClick={() => { updateMultipleClients(selectedIds, { color }); setSelectedIds([]) }}
                className="w-4 h-4 rounded-full border border-white/20 hover:scale-125 transition-transform"
                style={{ background: color }} />
            ))}
          </div>

          {/* Type */}
          {CLIENT_TYPES.map(type => (
            <button key={type}
              onClick={() => { updateMultipleClients(selectedIds, { type }); setSelectedIds([]) }}
              className="px-2 py-1 text-[9px] rounded font-bold capitalize hover:bg-white/10 text-white/50 hover:text-white">
              {type}
            </button>
          ))}

          {/* Role */}
          {roles.length > 0 && (
            <div className="border-l border-white/10 pl-3 ml-1 flex items-center gap-1">
              <span className="text-[8px] text-white/30 uppercase tracking-widest">Role</span>
              <select
                defaultValue=""
                onChange={e => { updateMultipleClients(selectedIds, { customRole: e.target.value || undefined }); e.target.value = '' }}
                className="bg-zinc-800 border border-white/10 rounded px-1 py-0.5 text-[9px] font-bold text-white cursor-pointer">
                <option value="">— set role —</option>
                <option value="">Clear role</option>
                {roles.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
              </select>
            </div>
          )}

          <div className="border-l border-white/10 pl-3 ml-1 flex gap-1">
            <button
              onClick={() => { updateMultipleClients(selectedIds, { hidden: true }); setSelectedIds([]) }}
              className="px-2 py-1 text-[9px] rounded font-bold hover:bg-white/10 text-white/50 hover:text-white">
              Hide
            </button>
            <button
              onClick={() => { updateMultipleClients(selectedIds, { hidden: false }); setSelectedIds([]) }}
              className="px-2 py-1 text-[9px] rounded font-bold hover:bg-white/10 text-white/50 hover:text-white">
              Show
            </button>
          </div>

          {/* Luk */}
          <button onClick={() => setSelectedIds([])}
            className="ml-2 p-1 rounded hover:bg-white/10 text-white/30 hover:text-white">
            <X size={12} />
          </button>
        </div>
      )}

      {contextMenu && (() => {
        const c = clients.find((cl: Client) => cl.id === contextMenu.clientId)
        if (!c) return null
        return (
          <div ref={contextMenuRef}
            className="fixed z-50 bg-zinc-900 border border-white/10 rounded-lg shadow-2xl p-3 w-52"
            style={{ top: contextMenu.y, left: contextMenu.x }}>
            <p className="text-xs font-bold text-white/50 mb-2 uppercase">{c.name}</p>
            <p className="text-[10px] text-white/30 mb-1">Type</p>
            <div className="grid grid-cols-4 gap-1 mb-3">
              <button
                onClick={() => { updateClient(c.id, { type: "" as any }); setContextMenu(null) }}
                className={`py-1 text-[9px] rounded capitalize ${(!c.type || (c.type as string) === "") ? `bg-${themeColor}-600 text-white` : "bg-white/10 hover:bg-white/20"}`}>
                —
              </button>
              {CLIENT_TYPES.map(type => (
                <button key={type}
                  onClick={() => { updateClient(c.id, { type }); setContextMenu(null) }}
                  className={`py-1 text-[9px] rounded capitalize
                    ${c.type === type ? `bg-${themeColor}-600 text-white` : "bg-white/10 hover:bg-white/20"}`}>
                  {type}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-white/30 mb-1">Color</p>
            <div className="flex flex-wrap gap-1 mb-3">
              {CLIENT_COLORS.map(color => (
                <button key={color}
                  onClick={() => { updateClient(c.id, { color }); setContextMenu(null) }}
                  className="w-5 h-5 rounded-full border-2 transition-transform hover:scale-110"
                  style={{ background: color, borderColor: c.color === color ? "white" : "transparent" }} />
              ))}
            </div>
            <div className="border-t border-white/10 pt-2 space-y-0.5">
              <button
                onClick={() => { setPopupClient(c); setPopupOpen(true); setContextMenu(null) }}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs hover:bg-white/10 text-white/60 hover:text-white">
                <Link2 size={11} /> Connections
              </button>
              <button
                onClick={() => { toggleMixer(c.id); setContextMenu(null) }}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs hover:bg-white/10 text-white/60 hover:text-white">
                <SlidersHorizontal size={11} /> Audio mixer
              </button>
              <button
                onClick={() => { setMappingClientId(c.id); setContextMenu(null) }}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs hover:bg-white/10 text-white/60 hover:text-white">
                <Keyboard size={11} /> Map key
              </button>
              <button
                onClick={() => {
                  socket.emit('client:kick', { clientId: c.id })
                  updateClient(c.id, { status: "offline", isTalking: false, isLatched: false })
                  setContextMenu(null)
                }}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs hover:bg-red-600/20 text-white/40 hover:text-red-400">
                <UserX size={11} /> Kick client
              </button>
            </div>
          </div>
        )
      })()}

    </div>
  )
}

/* ─── Server Config Panel ──────────────────────────────────────────────────── */

type ServerCfg = {
  isConfigured: boolean
  ip: string
  turnUrl: string
  turnUsername: string
  hasTurnPass: boolean
  hasSessionPw: boolean
  hasSsl: boolean
  sslCertPath: string
  sslKeyPath: string
}

function ServerConfigPanel({ themeColor }: { themeColor: string }) {
  const [cfg, setCfg] = useState<ServerCfg | null>(null)
  const [ip, setIp] = useState("")
  const [turnUrl, setTurnUrl] = useState("")
  const [turnUsername, setTurnUsername] = useState("")
  const [turnPassword, setTurnPassword] = useState("")
  const [sessionPassword, setSessionPassword] = useState("")
  const [sslCertPath, setSslCertPath] = useState("")
  const [sslKeyPath, setSslKeyPath] = useState("")
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    fetch("/api/config")
      .then(r => r.json())
      .then((c: ServerCfg) => {
        setCfg(c)
        setIp(c.ip)
        setTurnUrl(c.turnUrl)
        setTurnUsername(c.turnUsername)
        setSslCertPath(c.sslCertPath)
        setSslKeyPath(c.sslKeyPath)
      })
      .catch(() => {})
  }, [])

  const save = async () => {
    setSaving(true)
    try {
      await fetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ip, turnUrl, turnUsername,
          ...(turnPassword ? { turnPassword } : {}),
          ...(sessionPassword ? { sessionPassword } : {}),
          sslCertPath, sslKeyPath,
        }),
      })
      setSaved(true)
      setTimeout(() => window.location.reload(), 1500)
    } finally {
      setSaving(false)
    }
  }

  const accent = `${themeColor}-500`

  return (
    <div className="h-full overflow-y-auto px-4 py-4 space-y-5">

      {/* First-run warning banner */}
      {cfg && !cfg.isConfigured && (
        <div className="flex items-start gap-3 px-4 py-3 rounded-lg bg-amber-500/10 border border-amber-500/30">
          <span className="text-amber-400 text-lg leading-none mt-0.5">⚠</span>
          <div>
            <p className="text-xs font-black text-amber-300 uppercase tracking-widest mb-0.5">Serveren er ikke konfigureret</p>
            <p className="text-[11px] text-amber-200/60">
              Udfyld felterne herunder for at aktivere audio, TURN-relay og session-sikkerhed.
            </p>
          </div>
        </div>
      )}

      {/* IP */}
      <section>
        <p className="text-[10px] text-white/40 uppercase tracking-widest font-black mb-2">Server IP</p>
        <input
          value={ip}
          onChange={e => setIp(e.target.value)}
          placeholder="192.168.1.x  eller  dit-navn.duckdns.org"
          className="w-full bg-black border border-white/10 rounded px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-white/30"
        />
        <p className="text-[9px] text-white/25 mt-1">LAN-IP eller DuckDNS-domæne. Bruges af mediasoup til WebRTC-kandidater.</p>
      </section>

      {/* TURN */}
      <section>
        <p className="text-[10px] text-white/40 uppercase tracking-widest font-black mb-2">TURN Server <span className="text-white/20 font-normal normal-case tracking-normal">(kræves til internet-adgang)</span></p>
        <div className="space-y-2">
          <input
            value={turnUrl}
            onChange={e => setTurnUrl(e.target.value)}
            placeholder="turn:dit-navn.metered.live:80"
            className="w-full bg-black border border-white/10 rounded px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-white/30"
          />
          <div className="flex gap-2">
            <input
              value={turnUsername}
              onChange={e => setTurnUsername(e.target.value)}
              placeholder="Brugernavn"
              className="flex-1 bg-black border border-white/10 rounded px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-white/30"
            />
            <input
              type="password"
              value={turnPassword}
              onChange={e => setTurnPassword(e.target.value)}
              placeholder={cfg?.hasTurnPass ? "••••••• (behold)" : "Adgangskode"}
              className="flex-1 bg-black border border-white/10 rounded px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-white/30"
            />
          </div>
        </div>
        <p className="text-[9px] text-white/25 mt-1">Gratis TURN-server: metered.ca — kræves for adgang fra internet via mobildata.</p>
      </section>

      {/* Session password */}
      <section>
        <p className="text-[10px] text-white/40 uppercase tracking-widest font-black mb-2">Session-adgangskode <span className="text-white/20 font-normal normal-case tracking-normal">(valgfri)</span></p>
        <input
          type="password"
          value={sessionPassword}
          onChange={e => setSessionPassword(e.target.value)}
          placeholder={cfg?.hasSessionPw ? "••••••• (behold eksisterende)" : "Lad tomt for åben adgang"}
          className="w-full bg-black border border-white/10 rounded px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-white/30"
        />
        <p className="text-[9px] text-white/25 mt-1">Alle klienter skal angive denne kode ved tilkobling.</p>
      </section>

      {/* SSL */}
      <section>
        <p className="text-[10px] text-white/40 uppercase tracking-widest font-black mb-2">SSL-certifikat</p>
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-white/40 w-12 shrink-0">Cert</span>
            <input
              value={sslCertPath}
              onChange={e => setSslCertPath(e.target.value)}
              placeholder="/etc/easycom/ssl/cert.pem"
              className="flex-1 bg-black border border-white/10 rounded px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-white/30"
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-white/40 w-12 shrink-0">Key</span>
            <input
              value={sslKeyPath}
              onChange={e => setSslKeyPath(e.target.value)}
              placeholder="/etc/easycom/ssl/key.pem"
              className="flex-1 bg-black border border-white/10 rounded px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-white/30"
            />
          </div>
        </div>
        {cfg?.hasSsl && (
          <p className="text-[9px] text-green-400/60 mt-1">✓ SSL er konfigureret</p>
        )}
      </section>

      {/* Save */}
      <div className="pt-2">
        <button
          onClick={save}
          disabled={saving || saved}
          className={`w-full py-2.5 rounded text-xs font-black uppercase tracking-widest transition-colors
            ${saved
              ? "bg-green-600/30 text-green-300 border border-green-500/30"
              : `bg-${themeColor}-600 hover:bg-${themeColor}-500 text-white`
            }`}
        >
          {saved ? "✓ Gemt — genstarter..." : saving ? "Gemmer..." : "Gem og genstart server"}
        </button>
        <p className="text-[9px] text-white/20 text-center mt-2">Serveren genstarter automatisk efter gem — siden genindlæses.</p>
      </div>

    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────────
   GLOBAL SETUP TAB
───────────────────────────────────────────────────────────────────────────── */
import { IFBSettings } from "./IFBPanel"

const defaultGlobalIFB = (): IFBSettings => ({
  active: false,
  channels: Object.fromEntries(
    Array.from({ length: 16 }, (_, i) => [i + 1, { muted: false, duckAmount: 70 }])
  ),
})

const CH_COLORS_GLOBAL = [
  "#ef4444","#3b82f6","#22c55e","#a855f7",
  "#f97316","#06b6d4","#eab308","#ec4899",
]

function GlobalSetupTab({
  clients,
  themeColor,
  roles,
  onRolesChange,
  onApplyIFBToAll,
}: {
  clients: Client[]
  themeColor: string
  roles: { id: string; label: string; color: string }[]
  onRolesChange: (roles: { id: string; label: string; color: string }[]) => void
  onApplyIFBToAll: (s: IFBSettings) => void
}) {
  const accentColor = themeColor === "orange" ? "#f97316" : "#3b82f6"

  // Role editor state
  const [roleLabel, setRoleLabel] = React.useState("")
  const [roleColor, setRoleColor] = React.useState("#f97316")
  const [editingRoleId, setEditingRoleId] = React.useState<string | null>(null)

  const saveRole = () => {
    const label = roleLabel.trim()
    if (!label) return
    if (editingRoleId) {
      onRolesChange(roles.map(r => r.id === editingRoleId ? { ...r, label, color: roleColor } : r))
      setEditingRoleId(null)
    } else {
      onRolesChange([...roles, { id: crypto.randomUUID(), label, color: roleColor }])
    }
    setRoleLabel("")
    setRoleColor("#f97316")
  }

  const deleteRole = (id: string) => {
    onRolesChange(roles.filter(r => r.id !== id))
    if (editingRoleId === id) { setEditingRoleId(null); setRoleLabel(""); setRoleColor("#f97316") }
  }

  const startEdit = (r: { id: string; label: string; color: string }) => {
    setEditingRoleId(r.id)
    setRoleLabel(r.label)
    setRoleColor(r.color)
  }

  const [ifb, setIfb] = React.useState<IFBSettings>(() => {
    try {
      const saved = localStorage.getItem("easycom:global:ifb")
      return saved ? JSON.parse(saved) : defaultGlobalIFB()
    } catch { return defaultGlobalIFB() }
  })
  const [applied, setApplied] = React.useState(false)

  const getChannel = (ch: number) =>
    ifb.channels[ch] ?? { muted: false, duckAmount: 70 }

  const updateChannel = (ch: number, updates: Partial<{ muted: boolean; duckAmount: number }>) => {
    const next = {
      ...ifb,
      channels: { ...ifb.channels, [ch]: { ...getChannel(ch), ...updates } },
    }
    setIfb(next)
    try { localStorage.setItem("easycom:global:ifb", JSON.stringify(next)) } catch {}
  }

  const setAllDuck = (val: number) => {
    const next: IFBSettings = {
      ...ifb,
      channels: Object.fromEntries(
        Array.from({ length: 16 }, (_, i) => [i + 1, { ...getChannel(i + 1), duckAmount: val }])
      ),
    }
    setIfb(next)
    try { localStorage.setItem("easycom:global:ifb", JSON.stringify(next)) } catch {}
  }

  const applyAll = () => {
    onApplyIFBToAll(ifb)
    setApplied(true)
    setTimeout(() => setApplied(false), 2000)
  }

  const clientCount = clients.filter(c => c.id !== PRODUCER_ID).length

  return (
    <div className="h-full overflow-y-auto px-4 py-4 space-y-6">

      {/* ROLES SECTION */}
      <div className="space-y-3">
        <p className="text-[10px] text-white/40 uppercase tracking-widest font-bold">Client Roles</p>
        <p className="text-[9px] text-white/25">Create roles (e.g. Photographer, Producer) — assignable per client and visible on remote buttons.</p>

        {/* Existing roles */}
        <div className="space-y-1.5">
          {roles.map(r => (
            <div key={r.id} className="flex items-center gap-2 rounded-lg px-3 py-2" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}>
              <div className="w-3 h-3 rounded-full shrink-0" style={{ background: r.color }} />
              <span className="text-xs font-bold text-white flex-1">{r.label}</span>
              <button
                onClick={() => startEdit(r)}
                className="text-[9px] font-bold text-white/40 hover:text-white px-2 py-0.5 rounded hover:bg-white/10 transition-colors"
              >
                Edit
              </button>
              <button
                onClick={() => deleteRole(r.id)}
                className="text-[9px] font-bold text-red-400/60 hover:text-red-400 px-2 py-0.5 rounded hover:bg-red-500/10 transition-colors"
              >
                Delete
              </button>
            </div>
          ))}
          {roles.length === 0 && (
            <p className="text-[9px] text-white/20 italic px-1">No roles created yet.</p>
          )}
        </div>

        {/* Add / edit form */}
        <div className="flex items-center gap-2 rounded-xl p-3" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
          <input
            type="color"
            value={roleColor}
            onChange={e => setRoleColor(e.target.value)}
            className="w-7 h-7 rounded cursor-pointer border-0 bg-transparent shrink-0"
            title="Role color"
          />
          <input
            type="text"
            value={roleLabel}
            onChange={e => setRoleLabel(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && saveRole()}
            placeholder={editingRoleId ? "Edit role name…" : "New role name…"}
            className="flex-1 bg-transparent border border-white/10 rounded-lg px-3 py-1.5 text-xs font-bold text-white placeholder-white/20 outline-none focus:border-white/30"
          />
          <button
            onClick={saveRole}
            disabled={!roleLabel.trim()}
            className="px-3 py-1.5 rounded-lg text-xs font-black uppercase text-white disabled:opacity-30 transition-all"
            style={{ background: editingRoleId ? accentColor : accentColor }}
          >
            {editingRoleId ? "Save" : "Add"}
          </button>
          {editingRoleId && (
            <button
              onClick={() => { setEditingRoleId(null); setRoleLabel(""); setRoleColor("#f97316") }}
              className="px-3 py-1.5 rounded-lg text-xs font-black uppercase text-white/40 hover:text-white bg-white/5 hover:bg-white/10 transition-all"
            >
              Cancel
            </button>
          )}
        </div>
      </div>

      <div className="border-t border-white/5" />

      {/* IFB SECTION */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[10px] text-white/40 uppercase tracking-widest font-bold">IFB — Standard indstillinger</p>
            <p className="text-[9px] text-white/25 mt-0.5">
              Sæt standard IFB-indstillinger for alle klienter. Individuelle klienter kan stadig tilpasses bagefter.
            </p>
          </div>
        </div>

        {/* Duck all */}
        <div className="space-y-2 rounded-xl p-3" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
          <div className="flex items-center justify-between">
            <p className="text-[9px] text-white/40 uppercase tracking-widest font-bold">Duck-niveau (alle kanaler)</p>
            <span className="text-xs font-black text-white/60">{getChannel(1).duckAmount}%</span>
          </div>
          <input
            type="range" min={0} max={100}
            value={getChannel(1).duckAmount}
            onChange={e => setAllDuck(Number(e.target.value))}
            className="w-full h-1 appearance-none cursor-pointer rounded"
            style={{ accentColor }}
          />
          <p className="text-[9px] text-white/20">Hvor meget IFB-lyden sænkes når talekanalen er aktiv.</p>
        </div>

        {/* Per-channel grid */}
        <div className="space-y-1.5">
          <p className="text-[9px] text-white/30 uppercase tracking-widest font-bold">Kanaler</p>
          <div className="grid grid-cols-8 gap-1.5">
            {Array.from({ length: 8 }, (_, i) => {
              const ch = i + 1
              const s = getChannel(ch)
              const color = CH_COLORS_GLOBAL[(ch - 1) % CH_COLORS_GLOBAL.length]
              return (
                <button
                  key={ch}
                  onClick={() => updateChannel(ch, { muted: !s.muted })}
                  className="rounded-lg p-2 text-center transition-all"
                  style={s.muted
                    ? { background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }
                    : { background: color + "20", border: `1px solid ${color}60` }
                  }
                  title={`IFB ${ch} — klik for mute/unmute`}
                >
                  <div className="text-[9px] font-black" style={{ color: s.muted ? "rgba(255,255,255,0.2)" : color }}>
                    {ch}
                  </div>
                  <div className="text-[7px] mt-0.5" style={{ color: s.muted ? "rgba(255,255,255,0.15)" : "rgba(255,255,255,0.5)" }}>
                    {s.muted ? "off" : `${s.duckAmount}%`}
                  </div>
                </button>
              )
            })}
          </div>
          <p className="text-[8px] text-white/20">Klik for at mute/unmute en kanal. Procent viser duck-niveau.</p>
        </div>

        {/* Apply button */}
        <button
          onClick={applyAll}
          className="w-full py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all"
          style={applied
            ? { background: "rgba(34,197,94,0.15)", border: "1px solid rgba(34,197,94,0.4)", color: "#86efac" }
            : { background: accentColor, color: "white" }
          }
        >
          {applied
            ? `✓ APPLIED TO ${clientCount} CLIENTS`
            : `USE ON ALL ${clientCount} CLIENTS`
          }
        </button>
        <p className="text-[9px] text-white/20 text-center -mt-2">
          Individuelle klientindstillinger kan justeres via ⊕ på klientkortet.
        </p>
      </div>

    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────────
   SSL CONFIG SECTION (moved from old Server tab)
───────────────────────────────────────────────────────────────────────────── */
function SSLConfigSection({ themeColor }: { themeColor: string }) {
  const [sslCertPath, setSslCertPath] = React.useState("")
  const [sslKeyPath, setSslKeyPath] = React.useState("")
  const [hasSsl, setHasSsl] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [saved, setSaved] = React.useState(false)

  React.useEffect(() => {
    fetch("/api/config")
      .then(r => r.json())
      .then((c: any) => { setSslCertPath(c.sslCertPath ?? ""); setSslKeyPath(c.sslKeyPath ?? ""); setHasSsl(!!c.hasSsl) })
      .catch(() => {})
  }, [])

  const save = async () => {
    setSaving(true)
    try {
      await fetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sslCertPath, sslKeyPath }),
      })
      setSaved(true)
      setTimeout(() => window.location.reload(), 1500)
    } finally { setSaving(false) }
  }

  return (
    <div className="px-4 pt-3 pb-3 border-b border-white/5 shrink-0 space-y-2">
      <p className="text-[10px] text-white/40 uppercase tracking-widest font-bold">SSL-certifikat</p>
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-white/40 w-10 shrink-0">Cert</span>
        <input
          value={sslCertPath}
          onChange={e => setSslCertPath(e.target.value)}
          placeholder="/etc/easycom/ssl/cert.pem"
          className="flex-1 bg-black border border-white/10 rounded px-2 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-white/30"
        />
      </div>
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-white/40 w-10 shrink-0">Key</span>
        <input
          value={sslKeyPath}
          onChange={e => setSslKeyPath(e.target.value)}
          placeholder="/etc/easycom/ssl/key.pem"
          className="flex-1 bg-black border border-white/10 rounded px-2 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-white/30"
        />
      </div>
      {hasSsl && <p className="text-[9px] text-green-400/60">✓ SSL er konfigureret</p>}
      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={save} disabled={saving || saved}
          className="px-3 py-1.5 rounded text-[9px] font-black uppercase tracking-widest transition-colors text-white"
          style={{ background: saved ? "rgba(34,197,94,0.3)" : "#f97316" }}
        >
          {saved ? "✓ Gemt — genstarter..." : saving ? "Gemmer..." : "Gem SSL"}
        </button>
        <p className="text-[9px] text-white/20">Kræver server-genstart.</p>
      </div>
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────────
   DOCUMENTS TAB
───────────────────────────────────────────────────────────────────────────── */
function DocumentsTab() {
  const [doc, setDoc] = React.useState<"manual" | "license">("manual")

  return (
    <div className="h-full flex flex-col">
      <div className="flex gap-1 px-4 pt-3 pb-0 border-b border-white/5 shrink-0">
        {(["manual", "license"] as const).map(d => (
          <button key={d} onClick={() => setDoc(d)}
            className={`px-3 py-1.5 text-xs font-bold transition-colors
              ${doc === d ? "border-b-2 border-orange-500 text-orange-300" : "text-white/40 hover:text-white/70"}`}>
            {d === "manual" ? "Manual" : "Licens"}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto px-5 py-4">
        {doc === "manual" ? <EasyComManual /> : <EasyComLicense />}
      </div>
    </div>
  )
}

function DocH1({ children }: { children: React.ReactNode }) {
  return <h1 className="text-base font-black text-white uppercase tracking-widest mb-4 mt-6 first:mt-0">{children}</h1>
}
function DocH2({ children }: { children: React.ReactNode }) {
  return <h2 className="text-[10px] font-black text-orange-400 uppercase tracking-widest mb-2 mt-4">{children}</h2>
}
function DocP({ children }: { children: React.ReactNode }) {
  return <p className="text-[11px] text-white/60 leading-relaxed mb-2">{children}</p>
}
function DocLi({ children }: { children: React.ReactNode }) {
  return <li className="text-[11px] text-white/60 leading-relaxed mb-1">{children}</li>
}

function EasyComManual() {
  return (
    <div className="space-y-0 max-w-2xl">
      <DocH1>EasyCom — Brugermanual</DocH1>
      <p className="text-[9px] text-white/25 uppercase tracking-widest mb-6">Version 1.0 · Broadcast Intercom System</p>

      <DocH2>1. Oversigt</DocH2>
      <DocP>
        EasyCom er et professionelt broadcast intercom-system til tv- og radioproduktioner. Systemet bruger WebRTC til lav-latens audiokommunikation over LAN eller internet.
        Arkitekturen består af en HOST-server der kører på en Mac, og klienter der forbinder via webbrowser eller mobilapp.
      </DocP>

      <DocH2>2. Klienttyper</DocH2>
      <ul className="list-disc list-inside space-y-0 mb-3 pl-1">
        <DocLi><span className="text-white font-bold">Desktop</span> — PC/Mac-klient med op til 16 talekanaler (TB1–TB16) og 16 modtagekanaler.</DocLi>
        <DocLi><span className="text-white font-bold">Mobile</span> — iOS-app med 4 talekanaler og 8 modtagekanaler. Optimeret til håndholdt brug.</DocLi>
        <DocLi><span className="text-white font-bold">Remote</span> — Web-baseret klient til iPad/tablet. Ingen installation — åbnes i browser via QR-kode.</DocLi>
        <DocLi><span className="text-white font-bold">BASE</span> — Serverens egen mikrofon og højttaleroutput. Altid til stede som "producer-65".</DocLi>
      </ul>

      <DocH2>3. Første opsætning</DocH2>
      <DocP>
        Installér serveren via EasyCom Server DMG. Efter installation startes serveren automatisk og er tilgængelig på{" "}
        <span className="font-mono text-orange-400">http://localhost:3000/host</span> fra HOST-maskinen.
      </DocP>
      <ul className="list-disc list-inside space-y-0 mb-3 pl-1">
        <DocLi>Åbn SETUP → Network → indtast Server IP (LAN-IP eller domæne).</DocLi>
        <DocLi>For internet-adgang: konfigurér TURN-server (anbefales metered.ca).</DocLi>
        <DocLi>Cloudflare Tunnel startes automatisk og giver en sikker HTTPS-adresse.</DocLi>
      </ul>

      <DocH2>4. Oprette klienter</DocH2>
      <DocP>
        I GRID-tabben trykkes <span className="text-white font-bold">＋</span> for at oprette en ny klient. Angiv navn, type (desktop/mobile/remote) og en 4-cifret PIN-kode.
        Klienten forbinder via QR-kode eller URL og logger ind med PIN.
      </DocP>

      <DocH2>5. Forbindelser</DocH2>
      <DocP>
        Klik på et klientkort for at åbne forbindelses-panelet. Her opsættes talk- og modtageforbindelser per kanal.
      </DocP>
      <ul className="list-disc list-inside space-y-0 mb-3 pl-1">
        <DocLi><span className="text-white font-bold">TALK</span> — udgående kommunikation. Klienten trykker på TB-knappen for at tale.</DocLi>
        <DocLi><span className="text-white font-bold">RECEIVE</span> — indgående lyd til klientens høretelefoner.</DocLi>
        <DocLi>Forbindelser kan trækkes med mus i GRID-visning (drag-to-connect).</DocLi>
        <DocLi>Bidirektionelle forbindelser oprettes automatisk ved gruppeaktivering.</DocLi>
      </ul>

      <DocH2>6. Grupper</DocH2>
      <DocP>
        I GROUP-panelet oprettes grupper af klienter der alle skal høre hinanden. Grupper har en dedikeret kanal og kan aktiveres/deaktiveres med ét klik.
        PTT (push-to-talk) og LATCH (låst tale) styres per gruppe.
      </DocP>

      <DocH2>7. IFB — In-Fold Back</DocH2>
      <DocP>
        IFB sender programmets lyd til klientens øre med reduceret lydstyrke (ducking) når taleknappen aktiveres.
        Klik på headphone-ikonet ⊕ på klientkortet for at konfigurere IFB per klient.
        Standardindstillinger for alle klienter sættes i SETUP → Global Setup.
      </DocP>
      <ul className="list-disc list-inside space-y-0 mb-3 pl-1">
        <DocLi><span className="text-white font-bold">Duck-niveau</span> — procentdel der sænkes (0% = ingen sænkning, 100% = fuld mute).</DocLi>
        <DocLi><span className="text-white font-bold">Kanal mute</span> — kanalers IFB-lyd kan slukkes individuelt.</DocLi>
      </ul>

      <DocH2>8. Audio I/O</DocH2>
      <DocP>
        I SETUP → Audio I/O konfigureres serverens lydkort. Inputkanaler bruges til at injicere eksternt audiosignal (f.eks. programmix).
        Outputkanaler bruges til at sende intercom-lyd til eksterne enheder.
      </DocP>
      <ul className="list-disc list-inside space-y-0 mb-3 pl-1">
        <DocLi>Klik ⚙️ på en kanal for at konfigurere gain og routing.</DocLi>
        <DocLi>Bridge-kanaler vises i forbindelses-panelet og kan tildeles til klienter.</DocLi>
      </ul>

      <DocH2>9. Snapshots</DocH2>
      <DocP>
        Gem hele opsætningen (klienter, forbindelser, grupper) som et snapshot. Snapshots kan indlæses igen ved næste produktion.
        Klik på disk-ikonet i topmenuén for at gemme/indlæse.
      </DocP>

      <DocH2>10. Remote (iPad/Tablet)</DocH2>
      <DocP>
        Remote-klienter åbner EasyCom i Safari på en tablet — ingen installation nødvendig.
        Scan QR-koden fra SETUP → QR-kode (eller åbn{" "}
        <span className="font-mono text-orange-400">http://localhost:3000/qr</span> på HOST-maskinen).
        Remote-klienten tilbyder taleknapper og modtagekanaler tilsvarende en desktop-klient.
      </DocP>

      <DocH2>11. Sikkerhed</DocH2>
      <ul className="list-disc list-inside space-y-0 mb-3 pl-1">
        <DocLi>Session-adgangskode beskytter mod uautoriseret adgang (sættes i SETUP → Network).</DocLi>
        <DocLi>SSL-certifikat konfigureres i SETUP → Network → SSL for HTTPS på eget domæne.</DocLi>
        <DocLi>Cloudflare Tunnel giver automatisk HTTPS uden SSL-certifikat.</DocLi>
        <DocLi>Klienternes PIN-kode er 4-cifret og unikt per klient.</DocLi>
      </ul>

      <DocH2>12. Fejlfinding</DocH2>
      <ul className="list-disc list-inside space-y-0 mb-3 pl-1">
        <DocLi><span className="text-white font-bold">Ingen lyd:</span> Tjek at browseren har givet mikrofonrettighed. iOS kræver HTTPS.</DocLi>
        <DocLi><span className="text-white font-bold">Kan ikke forbinde:</span> Kontrollér at TURN-server er konfigureret ved internet-adgang.</DocLi>
        <DocLi><span className="text-white font-bold">QR fejler:</span> Sørg for at Cloudflare Tunnel er aktiv (grønt ikon i topmenu).</DocLi>
        <DocLi><span className="text-white font-bold">Server starter ikke:</span> Kør geninstallation fra EasyCom Server DMG.</DocLi>
        <DocLi><span className="text-white font-bold">Factory Reset:</span> SETUP → Reset sletter alle klienter og forbindelser (netværksindstillinger bevares).</DocLi>
      </ul>

      <div className="mt-6 pt-4 border-t border-white/5">
        <p className="text-[9px] text-white/20">EasyCom Broadcast Intercom System · Version 1.0 · © 2025 EasyCom Systems</p>
      </div>
    </div>
  )
}

function EasyComLicense() {
  return (
    <div className="space-y-0 max-w-2xl">
      <DocH1>Licensaftale</DocH1>
      <p className="text-[9px] text-white/25 uppercase tracking-widest mb-6">EasyCom Broadcast Intercom System · End-User License Agreement (EULA)</p>

      <DocH2>1. Parter</DocH2>
      <DocP>
        Denne licensaftale ("Aftalen") er indgået mellem EasyCom Systems ("Licensgiver") og den person eller organisation
        der installerer eller anvender EasyCom Broadcast Intercom System ("Licenstageren").
        Ved installation eller brug accepteres vilkårene i denne aftale.
      </DocP>

      <DocH2>2. Licensrettigheder</DocH2>
      <DocP>
        Licensgiver tildeler Licenstageren en ikke-eksklusiv, ikke-overdragelig, begrænset ret til at installere og anvende
        softwaren på det antal installationer som licensen dækker. Licensen er personlig og må ikke deles, overdrages eller videreudlicenseres.
      </DocP>

      <DocH2>3. Restriktioner</DocH2>
      <DocP>Licenstageren må ikke:</DocP>
      <ul className="list-disc list-inside space-y-0 mb-3 pl-1">
        <DocLi>Kopiere, distribuere eller videreudlicensere softwaren til tredjeparter.</DocLi>
        <DocLi>Reverse-engineere, dekompilere eller adskille softwarens kildekode.</DocLi>
        <DocLi>Fjerne eller ændre ophavsrettigheds- eller varemærkenotater i softwaren.</DocLi>
        <DocLi>Anvende softwaren til ulovlige formål eller i strid med gældende lovgivning.</DocLi>
        <DocLi>Anvende EasyCom-branding eller varemærker uden skriftlig tilladelse.</DocLi>
      </ul>

      <DocH2>4. Ejendomsret</DocH2>
      <DocP>
        Softwaren og alle tilhørende rettigheder forbliver Licensgivers ejendom. Denne aftale giver Licenstageren en brugsret,
        ikke ejerskab. Alle rettigheder der ikke udtrykkeligt er tildelt, forbeholdes Licensgiveren.
      </DocP>

      <DocH2>5. Opdateringer og support</DocH2>
      <DocP>
        Licensgiver kan efter eget skøn udgive opdateringer, fejlrettelser og nye versioner. Support ydes i overensstemmelse
        med den tilknyttede supportaftale. Licensgiver er ikke forpligtet til at udgive opdateringer eller yde support uden en
        gyldig supportaftale.
      </DocP>

      <DocH2>6. Databeskyttelse</DocH2>
      <DocP>
        EasyCom indsamler ikke personoplysninger fra slutbrugerne. Al lyd- og videokommunikation transmitteres direkte
        mellem klienter via den konfigurerede server og lagres ikke. Det er Licenstagernes ansvar at overholde gældende
        persondatalovgivning (GDPR) i forbindelse med anvendelsen af systemet.
      </DocP>

      <DocH2>7. Ansvarsbegrænsning</DocH2>
      <DocP>
        Softwaren leveres "som den er" uden garantier af nogen art, hverken udtrykkelige eller underforståede.
        Licensgiver er ikke ansvarlig for direkte, indirekte, tilfældige, særlige eller følgeskader som følge af anvendelse
        af softwaren, herunder men ikke begrænset til tab af data, avancetab eller driftsforstyrrelser.
        Licensgivers samlede erstatningsansvar kan maksimalt udgøre den betalte licensafgift de seneste 12 måneder.
      </DocP>

      <DocH2>8. Opsigelse</DocH2>
      <DocP>
        Aftalen er gyldig indtil den opsiges. Licensgiveren kan opsige aftalen med øjeblikkelig virkning ved overtrædelse af
        aftalens vilkår. Ved opsigelse skal Licenstageren slette alle kopier af softwaren.
      </DocP>

      <DocH2>9. Lovvalg</DocH2>
      <DocP>
        Denne aftale er underlagt dansk ret. Eventuelle tvister afgøres ved de danske domstole med Retten i København
        som værneting i første instans.
      </DocP>

      <DocH2>10. Kontakt</DocH2>
      <DocP>
        Spørgsmål til denne aftale rettes til EasyCom Systems på{" "}
        <span className="text-orange-400 font-mono">info@easycom.dk</span>.
      </DocP>

      <div className="mt-6 pt-4 border-t border-white/5">
        <p className="text-[9px] text-white/20">© 2025 EasyCom Systems. Alle rettigheder forbeholdes. Version 1.0</p>
      </div>
    </div>
  )
}

export default HostView
