import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Tablet, Wifi, Settings, Plus, Radio, Zap, Activity, X, ChevronRight, Speaker, Network, ShieldCheck, GripVertical, Trash2, Globe, Users, Link2, AlertTriangle, ChevronDown, Monitor, Maximize2, Mic, Anchor, UserCheck, Grid, Layers, GripHorizontal, Cpu, Laptop, Box, Search, Palette, RefreshCcw, Type, Trash, Volume2, CheckSquare, Square, Edit3, SlidersHorizontal } from 'lucide-react';
import { Client, MappedClient, RemoteHost, RemotePanelNode } from '../types';
import RemoteAppView from './RemoteAppView';
import { socket } from '../client/webrtc/intercom';

type PanelAction = 'map' | 'monitor' | 'advanced' | 'app' | null;

interface RemotePanelViewProps {
  clients: Client[];
  allClients: Client[];
  updateClient: (id: string, updates: Partial<Client>) => void;
  remoteHosts: RemoteHost[];
  panelMappings: Record<string, (MappedClient | null)[]>;
  setPanelMappings: React.Dispatch<React.SetStateAction<Record<string, (MappedClient | null)[]>>>;
  theme: 'orange' | 'blue';
  sharedStream1: MediaStream | null;
  sharedStream2: MediaStream | null;
  remotePanels: RemotePanelNode[];
  setRemotePanels: React.Dispatch<React.SetStateAction<RemotePanelNode[]>>;
  panelActiveKeys: Record<string, boolean[]>;
  setPanelActiveKeys: React.Dispatch<React.SetStateAction<Record<string, boolean[]>>>;
  onKeyChange?: (panelId: string, slotIdx: number, isDown: boolean) => void;
  roles?: { id: string; label: string; color: string }[];
}

interface PanelGroup {
  id: string; name: string; memberIds: string[]; color: string
}

interface SlotData {
  clientId?: string
  groupId?: string
  name: string
  color: string
  textScale: number
  isGroup?: boolean
  memberIds?: string[]
  outputChannel?: number
}

const SLOT_COLORS = ['#f97316','#3b82f6','#22c55e','#a855f7','#ef4444','#eab308','#06b6d4','#ec4899','#14b8a6','#f43f5e','#8b5cf6','#10b981']

const LayoutWorkspace: React.FC<{
  panel: RemotePanelNode; clients: Client[]
  mappings: (MappedClient | null)[]; setMappings: (m: (MappedClient | null)[]) => void
  theme: 'orange' | 'blue'
  linkedClientId?: string
}> = ({ panel, clients, mappings, setMappings, theme, linkedClientId }) => {
  const accentColor = theme === 'orange' ? '#f97316' : '#3b82f6'
  const [groups, setGroups] = useState<PanelGroup[]>([])
  const [slots, setSlots] = useState<(SlotData | null)[]>(() => {
    if (mappings && mappings.length > 0) {
      return Array(panel.slotCount).fill(null).map((_, i) => {
        const m = mappings[i]
        if (!m) return null
        return {
          clientId: m.isGroupLatch ? undefined : m.id,
          groupId: m.isGroupLatch ? m.id : undefined,
          name: m.name,
          color: m.color,
          isGroup: !!m.isGroupLatch,
          memberIds: m.memberIds,
          textScale: 1,
          outputChannel: m.outputChannel
        } as SlotData
      })
    }
    return Array(panel.slotCount).fill(null)
  })
  const [selected, setSelected] = useState<number[]>([]) // selected slot indices
  const [showGroupEditor, setShowGroupEditor] = useState(false)
  const [editGroup, setEditGroup] = useState<PanelGroup | null>(null)
  const [groupName, setGroupName] = useState('')
  const [groupColor, setGroupColor] = useState('#f97316')
  const [selectedClientIds, setSelectedClientIds] = useState<string[]>([])
  const [showColorPicker, setShowColorPicker] = useState<number | null>(null)
  const GROUP_COLORS = SLOT_COLORS

  // Sync slots → mappings
  useEffect(() => {
    const m = slots.map(s => s ? { id: s.clientId ?? s.groupId ?? '?', name: s.name, color: s.color, isGroupLatch: !!s.isGroup, memberIds: s.memberIds, outputChannel: s.outputChannel } as any : null)
    setMappings(m)
  }, [slots])

  const openNewGroup = () => { setEditGroup(null); setGroupName(''); setGroupColor('#f97316'); setSelectedClientIds([]); setShowGroupEditor(true) }
  const openEditGroup = (g: PanelGroup) => { setEditGroup(g); setGroupName(g.name); setGroupColor(g.color); setSelectedClientIds(g.memberIds); setShowGroupEditor(true) }

  const saveGroup = () => {
    if (!groupName.trim() || selectedClientIds.length === 0) return
    if (editGroup) setGroups(prev => prev.map(g => g.id === editGroup.id ? { ...g, name: groupName.toUpperCase(), color: groupColor, memberIds: selectedClientIds } : g))
    else setGroups(prev => [...prev, { id: `grp-${Date.now()}`, name: groupName.toUpperCase(), color: groupColor, memberIds: selectedClientIds }])
    setShowGroupEditor(false)
  }

  const dropOnSlot = (e: React.DragEvent, slotIdx: number) => {
    e.preventDefault()
    const clientId = e.dataTransfer.getData('clientId')
    const groupId = e.dataTransfer.getData('groupId')
    const fromSlot = e.dataTransfer.getData('fromSlot')
    const newSlots = [...slots]
    if (fromSlot !== '') {
      const fi = parseInt(fromSlot); const tmp = newSlots[slotIdx]; newSlots[slotIdx] = newSlots[fi]; newSlots[fi] = tmp
    } else if (groupId) {
      const g = groups.find(x => x.id === groupId)
      if (g) newSlots[slotIdx] = { groupId: g.id, name: g.name, color: g.color, isGroup: true, memberIds: g.memberIds, textScale: slots[slotIdx]?.textScale ?? 1 }
    } else if (clientId) {
      const c = clients.find(x => x.id === clientId)
      if (c) {
        newSlots[slotIdx] = { clientId: c.id, name: c.name, color: '', textScale: slots[slotIdx]?.textScale ?? 1, outputChannel: slots[slotIdx]?.outputChannel }
      }
    }
    setSlots(newSlots)
  }

  const clearSlot = (i: number) => { const s=[...slots]; s[i]=null; setSlots(s); setSelected(p => p.filter(x=>x!==i)) }

  const toggleSelect = (i: number, e: React.MouseEvent) => {
    if (e.shiftKey) setSelected(p => p.includes(i) ? p.filter(x=>x!==i) : [...p, i])
    else setSelected(p => p.includes(i) && p.length === 1 ? [] : [i])
  }

  const setSelectedScale = (scale: number) => {
    setSlots(prev => prev.map((s, i) => selected.includes(i) && s ? { ...s, textScale: scale } : s))
  }

  const setSelectedColor = (color: string) => {
    setSlots(prev => prev.map((s, i) => selected.includes(i) && s ? { ...s, color } : s))
    setShowColorPicker(null)
  }

  const setSlotName = (i: number, name: string) => {
    setSlots(prev => prev.map((s, idx) => idx === i && s ? { ...s, name } : s))
  }

  const setSelectedChannel = (ch: number) => {
    setSlots(prev => prev.map((s, i) => selected.includes(i) && s ? { ...s, outputChannel: ch } : s))
  }

  const cols = panel.gridColumns || 8
  const selSlot = selected.length === 1 ? slots[selected[0]] : null
  const effectiveChannel = (s: SlotData | null, _idx: number) => s?.outputChannel ?? 1
  const firstSelCh = selected.length > 0 ? effectiveChannel(slots[selected[0]], selected[0]) : 1
  const allSameChannel = selected.every(i => effectiveChannel(slots[i], i) === firstSelCh)

  return (
    <div className="flex h-full overflow-hidden relative">
      {/* SIDEBAR */}
      <div className="w-56 border-r border-white/5 bg-zinc-950 flex flex-col shrink-0 overflow-hidden">

        {/* Selection tools */}
        {selected.length > 0 && (
          <div className="px-3 py-2 border-b border-white/5 bg-zinc-900/60 space-y-2 shrink-0">
            <p className="text-[8px] font-black text-white/50 uppercase tracking-widest">{selected.length} selected</p>
            {/* Text scale for selected */}
            <div>
              <div className="flex justify-between mb-1">
                <span className="text-[8px] text-zinc-500 uppercase">Text size</span>
                <span className="text-[8px] font-mono text-zinc-400">{Math.round((selSlot?.textScale ?? 1) * 100)}%</span>
              </div>
              <input type="range" min={40} max={200}
                value={Math.round((selSlot?.textScale ?? 1) * 100)}
                onChange={e => setSelectedScale(parseInt(e.target.value) / 100)}
                className="w-full h-1 rounded cursor-pointer appearance-none bg-zinc-800"
                style={{ accentColor }} />
            </div>
            {/* Color for selected */}
            <div>
              <p className="text-[8px] text-zinc-500 uppercase mb-1">Color</p>
              <div className="flex flex-wrap gap-1">
                {SLOT_COLORS.map(col => (
                  <button key={col} onClick={() => setSelectedColor(col)}
                    className="w-4 h-4 rounded-full border transition-transform hover:scale-110"
                    style={{ background: col, borderColor: selSlot?.color === col ? 'white' : 'transparent' }} />
                ))}
              </div>
            </div>
            {/* Output channel */}
            <div>
              <p className="text-[8px] text-zinc-500 uppercase mb-1">Output channel</p>
              <div className="flex items-center gap-1">
                <button onClick={() => setSelectedChannel(Math.max(1, firstSelCh - 1))}
                  className="w-6 h-6 flex items-center justify-center bg-zinc-800 rounded text-zinc-400 text-[9px] hover:text-white hover:bg-zinc-700">−</button>
                <input type="number" min={1} max={32}
                  value={allSameChannel ? firstSelCh : ''}
                  placeholder={allSameChannel ? '' : '—'}
                  onChange={e => { const v = parseInt(e.target.value); if (!isNaN(v) && v >= 1 && v <= 32) setSelectedChannel(v) }}
                  className="flex-1 bg-black border border-white/10 rounded px-1 py-1 text-[9px] font-mono text-white text-center outline-none" />
                <button onClick={() => setSelectedChannel(Math.min(32, firstSelCh + 1))}
                  className="w-6 h-6 flex items-center justify-center bg-zinc-800 rounded text-zinc-400 text-[9px] hover:text-white hover:bg-zinc-700">+</button>
              </div>
              {selected.length > 1 && !allSameChannel && (
                <p className="text-[7px] text-zinc-600 mt-0.5">Mixed — set value to apply to all</p>
              )}
            </div>
            {/* Name edit if single */}
            {selected.length === 1 && selSlot && (
              <input value={selSlot.name} onChange={e => setSlotName(selected[0], e.target.value.toUpperCase())}
                className="w-full bg-black border border-white/10 rounded px-2 py-1 text-[9px] font-black text-white uppercase outline-none"
                placeholder="SLOT NAME" />
            )}
          </div>
        )}

        {/* Groups */}
        <div className="px-3 py-2 border-b border-white/5 shrink-0">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[8px] font-black text-zinc-500 uppercase tracking-widest">Groups</span>
            <button onClick={openNewGroup} className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[8px] font-black text-white" style={{ background: accentColor + '30' }}>
              <Plus size={8} /> New
            </button>
          </div>
          <div className="space-y-1">
            {groups.map(g => (
              <div key={g.id} draggable
                onDragStart={e => { e.dataTransfer.setData('groupId', g.id); e.dataTransfer.setData('clientId',''); e.dataTransfer.setData('fromSlot','') }}
                className="flex items-center gap-1.5 px-2 py-1 rounded-lg border border-white/5 cursor-grab hover:bg-zinc-800 group mb-0.5"
                style={{ background: g.color + '18' }}>
                <div className="w-2 h-2 rounded-sm shrink-0" style={{ background: g.color }} />
                <span className="text-[8px] font-black text-white uppercase truncate flex-1">{g.name}</span>
                <span className="text-[7px] text-zinc-600">{g.memberIds.length}</span>
                <button onClick={() => openEditGroup(g)} className="opacity-0 group-hover:opacity-100"><Edit3 size={8} className="text-zinc-500 hover:text-white" /></button>
                <button onClick={() => setGroups(p => p.filter(x => x.id !== g.id))} className="opacity-0 group-hover:opacity-100"><Trash size={8} className="text-zinc-500 hover:text-red-400" /></button>
              </div>
            ))}
            {groups.length === 0 && <p className="text-[8px] text-zinc-700 italic">No groups yet</p>}
          </div>
        </div>

        {/* Clients */}
        <div className="px-3 py-1.5 border-b border-white/5 shrink-0">
          <span className="text-[8px] font-black text-zinc-500 uppercase tracking-widest">Clients</span>
        </div>
        <div className="flex-1 overflow-auto p-2 space-y-1">
          {clients.map((c, ci) => (
            <div key={c.id} draggable
              onDragStart={e => { e.dataTransfer.setData('clientId', c.id); e.dataTransfer.setData('groupId',''); e.dataTransfer.setData('fromSlot','') }}
              className="flex items-center gap-1.5 px-2 py-1.5 bg-zinc-900 rounded-lg border border-white/5 cursor-grab hover:bg-zinc-800 transition-all">
              <div className="w-2 h-2 rounded-full shrink-0" style={{ background: SLOT_COLORS[ci % SLOT_COLORS.length] }} />
              <span className="text-[8px] font-black text-white uppercase truncate">{c.name}</span>
              <GripVertical size={8} className="ml-auto text-zinc-600 shrink-0" />
            </div>
          ))}
        </div>
        <div className="px-3 py-2 border-t border-white/5 shrink-0">
          <p className="text-[7px] text-zinc-700">Shift+click to multi-select</p>
        </div>
      </div>

      {/* GRID */}
      <div className="flex-1 overflow-auto p-3">
        <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
          {slots.map((slot, i) => {
            const isSel = selected.includes(i)
            return (
              <div key={i}
                draggable={!!slot}
                onClick={e => toggleSelect(i, e)}
                onDragStart={e => { if (!slot) return; e.dataTransfer.setData('fromSlot', String(i)); e.dataTransfer.setData('clientId',''); e.dataTransfer.setData('groupId','') }}
                onDragOver={e => e.preventDefault()}
                onDrop={e => dropOnSlot(e, i)}
                onDoubleClick={() => clearSlot(i)}
                className="rounded-xl border-2 flex flex-col items-center justify-center text-center transition-all select-none relative"
                style={{
                  background: slot ? slot.color+'22' : 'rgba(255,255,255,0.02)',
                  borderColor: isSel ? 'white' : slot ? slot.color : 'rgba(255,255,255,0.06)',
                  aspectRatio: '1', minHeight: 72,
                  cursor: slot ? 'grab' : 'default',
                  boxShadow: isSel ? '0 0 0 2px white' : 'none'
                }}>
                {slot && (
                  <span className="font-black text-white uppercase leading-tight px-1 break-all"
                    style={{ fontSize: `${Math.round(9 * (slot.textScale ?? 1))}px` }}>{slot.name}</span>
                )}
                {slot && (
                  <span className="absolute bottom-1 left-1 text-[9px] font-mono font-bold leading-none px-1 py-0.5 rounded"
                    style={{ background: 'rgba(0,0,0,0.55)', color: slot.color || 'rgba(255,255,255,0.5)' }}>
                    CH{effectiveChannel(slot, i)}
                  </span>
                )}
                {isSel && <div className="absolute top-1 right-1 w-2 h-2 rounded-full bg-white" />}
              </div>
            )
          })}
        </div>
        <p className="text-[7px] text-zinc-700 mt-2 text-center">Click to select · Shift+click multi-select · Drag to reorder · Double-click to clear</p>
      </div>

      {/* GROUP EDITOR */}
      {showGroupEditor && (
        <div className="absolute inset-0 bg-black/80 z-50 flex items-center justify-center">
          <div className="bg-zinc-900 border border-white/10 rounded-2xl p-5 w-80 space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-black text-white uppercase">{editGroup ? 'Edit' : 'New'} Group</h4>
              <button onClick={() => setShowGroupEditor(false)} className="p-1 text-zinc-500 hover:text-white"><X size={14} /></button>
            </div>
            <input value={groupName} onChange={e => setGroupName(e.target.value.toUpperCase())} placeholder="GROUP NAME"
              className="w-full bg-black border border-white/10 rounded-lg px-3 py-2 text-xs font-black text-white uppercase outline-none" />
            <div className="flex gap-1.5 flex-wrap">
              {GROUP_COLORS.map(col => (
                <button key={col} onClick={() => setGroupColor(col)} className="w-5 h-5 rounded-full border-2 hover:scale-110 transition-transform"
                  style={{ background: col, borderColor: groupColor === col ? 'white' : 'transparent' }} />
              ))}
            </div>
            <div className="max-h-36 overflow-auto space-y-1">
              {clients.map(c => {
                const sel = selectedClientIds.includes(c.id)
                return (
                  <button key={c.id} onClick={() => setSelectedClientIds(p => sel ? p.filter(x=>x!==c.id) : [...p,c.id])}
                    className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg border transition-all text-left"
                    style={{ background: sel ? groupColor+'20':'transparent', borderColor: sel ? groupColor+'60':'rgba(255,255,255,0.05)' }}>
                    <span className="text-[9px] font-black text-white uppercase">{c.name}</span>
                    {sel && <CheckSquare size={9} className="ml-auto" style={{ color: groupColor }} />}
                  </button>
                )
              })}
            </div>
            <div className="flex gap-2">
              {editGroup && <button onClick={() => { setGroups(p=>p.filter(x=>x.id!==editGroup.id)); setShowGroupEditor(false) }}
                className="px-3 py-1.5 rounded-lg bg-red-900/30 text-red-400 text-[9px] font-black border border-red-500/20">Delete</button>}
              <button onClick={saveGroup} disabled={!groupName.trim()||selectedClientIds.length===0}
                className="flex-1 py-1.5 rounded-lg text-white text-[9px] font-black uppercase disabled:opacity-30" style={{ background: accentColor }}>
                {editGroup ? 'Save' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}


const RemotePanelView: React.FC<RemotePanelViewProps> = ({
  clients: localClients, allClients, updateClient, remoteHosts, panelMappings, setPanelMappings, theme,
  sharedStream1, sharedStream2, remotePanels, setRemotePanels, panelActiveKeys, setPanelActiveKeys, onKeyChange, roles = []
}) => {
  const [activePanelId, setActivePanelId] = useState<string | null>(null);
  const [action, setAction] = useState<PanelAction>(null);
  const [isAddingPanel, setIsAddingPanel] = useState(false);
  const [selectedSlotIdx, setSelectedSlotIdx] = useState<number | null>(null);
  const [editingPanelId, setEditingPanelId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  
  const themeColor = theme === 'orange' ? 'orange' : 'blue';
  const activePanel = useMemo(() => remotePanels.find(p => p.id === activePanelId), [remotePanels, activePanelId]);

  const handleMockupInteraction = (mapping: MappedClient, slotIdx: number, isDown: boolean) => {
    if (!activePanelId) return;
    if (mapping.isGroupLatch) {
      if (isDown) {
        const members = mapping.memberIds || [];
        const targetClients = localClients.filter(c => members.includes(c.id));
        const anyOn = targetClients.some(c => c.isLatched);
        targetClients.forEach(c => updateClient(c.id, { isLatched: !anyOn }));
      }
      return;
    }

    const client = localClients.find(c => c.id === mapping.id);
    if (!client) return;

    if (mapping.isLatchCopy) {
      if (isDown) {
        const nextState = !client.isLatched;
        updateClient(client.id, { isLatched: nextState });
        onKeyChange?.(activePanelId, slotIdx, nextState);
      }
    } else {
      updateClient(client.id, { isTalking: isDown });
      onKeyChange?.(activePanelId, slotIdx, isDown);
    }
  };

  const addPanel = (type: 'pad' | 'streamdeck') => {
    const id = `rp-${Date.now()}`;
    const slotCount = 32;
    const newPanel: RemotePanelNode = {
      id, name: type === 'streamdeck' ? 'SD-STUDIO-1' : 'RP-PAD-1',
      ip: '0.0.0.0', type: 'Remote Device', panelType: type, status: 'connected',
      gridColumns: 8, slotCount, audioInputChannel: 1
    };
    setRemotePanels([...remotePanels, newPanel]);
    setPanelMappings(prev => ({ ...prev, [id]: Array(slotCount).fill(null) }));
    setPanelActiveKeys(prev => ({ ...prev, [id]: Array(slotCount).fill(false) }));
    setIsAddingPanel(false);
  };

  const closeOverlay = () => { setActivePanelId(null); setAction(null); };

  return (
    <div className="h-full flex flex-col p-8 bg-[#0a0c10] relative overflow-hidden">
      <div className="flex items-center justify-between mb-8 shrink-0">
        <div>
          <h2 className="text-3xl font-black text-white italic tracking-tighter uppercase">Remote Terminals</h2>
          <p className="text-sm text-zinc-500 font-bold uppercase tracking-widest mt-1 italic">Inter-Node Logic Management</p>
        </div>
        <button onClick={() => setIsAddingPanel(true)} className={`flex items-center gap-2 px-6 py-3 bg-${themeColor}-600 text-white font-black rounded-xl bevel uppercase tracking-widest text-xs shadow-lg`}>
          <Plus size={18} /> New Remote
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 overflow-y-auto">
        {remotePanels.map(panel => (
          <div key={panel.id} className="bg-zinc-900/50 border border-white/10 rounded-2xl p-6 bevel no-active group hover:border-zinc-700 transition-all">
            <div className="flex items-center justify-between mb-6">
               <div className="flex items-center gap-4">
                  <div className={`p-3 rounded-xl border border-white/5 ${panel.panelType === 'streamdeck' ? 'bg-blue-950/40' : 'bg-orange-950/40'}`}>
                    {panel.panelType === 'streamdeck'
                      ? <Grid size={24} className="text-blue-400" />
                      : <Tablet size={24} className="text-orange-400" />}
                  </div>
                  <div>
                    {editingPanelId === panel.id ? (
                      <input autoFocus value={editingName}
                        onChange={e => setEditingName(e.target.value)}
                        onBlur={() => { setRemotePanels(prev => prev.map(p => p.id === panel.id ? { ...p, name: editingName.toUpperCase() } : p)); setEditingPanelId(null) }}
                        onKeyDown={e => { if (e.key === 'Enter') { setRemotePanels(prev => prev.map(p => p.id === panel.id ? { ...p, name: editingName.toUpperCase() } : p)); setEditingPanelId(null) } e.stopPropagation() }}
                        className="bg-black border border-white/20 rounded px-2 py-0.5 text-white font-black text-lg uppercase w-40 outline-none"
                      />
                    ) : (
                      <h3 className="font-black text-white text-lg leading-tight uppercase cursor-pointer hover:text-zinc-300"
                        onDoubleClick={() => { setEditingPanelId(panel.id); setEditingName(panel.name) }}>
                        {panel.name}
                      </h3>
                    )}
                    <p className="text-[9px] text-zinc-600 italic">double-click to rename</p>
                  </div>
               </div>
            </div>
            <div className="space-y-3">
              {/* Client selector – only available remote clients */}
              {(() => {
                const usedIds = remotePanels.filter(p => p.id !== panel.id && p.linkedClientId).map(p => p.linkedClientId!)
                const available = allClients.filter(c => c.type === 'remote' && (!usedIds.includes(c.id) || c.id === panel.linkedClientId))
                return (
                  <div>
                    <label className="text-[8px] font-black text-zinc-600 uppercase tracking-widest mb-1 block">Linked Client</label>
                    <select
                      value={panel.linkedClientId ?? ''}
                      onChange={e => setRemotePanels(prev => prev.map(p => p.id === panel.id ? { ...p, linkedClientId: e.target.value || undefined } : p))}
                      className="w-full bg-zinc-800 border border-white/10 rounded-lg px-3 py-2 text-xs text-white font-bold appearance-none cursor-pointer hover:border-white/20 transition-colors">
                      <option value="">— no client —</option>
                      {available.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </div>
                )
              })()}
              <button onClick={() => { setActivePanelId(panel.id); setAction('map'); }} className="w-full py-3 bg-zinc-800 border border-white/5 rounded-lg text-[10px] font-black text-zinc-400 uppercase tracking-widest hover:text-white bevel">Layout Workspace</button>
              <button onClick={() => { setActivePanelId(panel.id); setAction('app'); }} className="w-full py-2.5 bg-zinc-800 border border-white/5 rounded-lg text-[10px] font-black text-zinc-400 uppercase tracking-widest hover:text-white bevel flex items-center justify-center gap-2"><Monitor size={12} /> Launch Virtual PAD</button>
              <button
                onClick={() => {
                  if (window.confirm(`Delete panel "${panel.name}"? This cannot be undone.`)) {
                    setRemotePanels(prev => prev.filter(p => p.id !== panel.id))
                    setPanelMappings(prev => { const n = { ...prev }; delete n[panel.id]; return n })
                    setPanelActiveKeys(prev => { const n = { ...prev }; delete n[panel.id]; return n })
                  }
                }}
                className="w-full py-2 bg-zinc-900 border border-red-500/20 rounded-lg text-[10px] font-black text-red-500/60 uppercase tracking-widest hover:bg-red-950/40 hover:text-red-400 hover:border-red-500/40 bevel flex items-center justify-center gap-2 transition-all">
                <Trash2 size={11} /> Delete Panel
              </button>
            </div>
          </div>
        ))}
      </div>

      {isAddingPanel && (
        <div className="fixed inset-0 bg-black/80 z-[200] flex items-center justify-center backdrop-blur-md">
          <div className="bg-zinc-900 border border-white/10 rounded-3xl p-8 w-[420px] space-y-6">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-black text-white uppercase italic tracking-tighter">Add New Panel</h3>
              <button onClick={() => setIsAddingPanel(false)} className="p-2 bg-zinc-800 rounded-full text-zinc-400 hover:text-white"><X size={16} /></button>
            </div>
            <p className="text-[11px] text-zinc-500 uppercase tracking-widest">Choose panel type</p>
            <div className="grid grid-cols-2 gap-4">
              <button onClick={() => addPanel('pad')}
                className={`flex flex-col items-center gap-3 p-6 bg-zinc-800 border border-white/5 rounded-2xl hover:border-${themeColor}-500/50 hover:bg-${themeColor}-900/20 transition-all bevel`}>
                <Tablet size={32} className={`text-${themeColor}-500`} />
                <span className="text-xs font-black text-white uppercase">iPad</span>
                <span className="text-[9px] text-zinc-500 text-center">Virtual intercom panel for iPad or tablet</span>
              </button>
              <button onClick={() => addPanel('streamdeck')}
                className={`flex flex-col items-center gap-3 p-6 bg-zinc-800 border border-white/5 rounded-2xl hover:border-${themeColor}-500/50 hover:bg-${themeColor}-900/20 transition-all bevel`}>
                <Grid size={32} className={`text-${themeColor}-500`} />
                <span className="text-xs font-black text-white uppercase">Panel</span>
                <span className="text-[9px] text-zinc-500 text-center">Elgato Stream Deck Studio hardware panel</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {action && activePanel && (
        <div className="fixed inset-0 bg-black/95 z-[100] flex items-center justify-center p-6 backdrop-blur-md">
           <div className="w-full max-w-[1500px] h-full max-h-[95vh] bg-zinc-950 border border-white/10 rounded-3xl overflow-hidden flex flex-col bevel no-active">
              <div className="p-6 border-b border-white/10 bg-zinc-900 flex items-center justify-between shrink-0">
                  <h3 className="text-lg font-black text-white uppercase italic tracking-tighter">{activePanel.name}</h3>
                  <button onClick={closeOverlay} className="p-2 bg-zinc-800 rounded-full text-zinc-400 bevel"><X size={20} /></button>
              </div>
              <div className="flex-1 overflow-hidden flex relative">
                {action === 'app' && (
                  <RemoteAppView
                    clients={localClients} updateClient={updateClient}
                    mappings={panelMappings[activePanel.id] || []} theme={theme}
                    panelName={activePanel.name} sharedStream1={sharedStream1} sharedStream2={sharedStream2}
                    onTalkToggle={(idx, val) => onKeyChange?.(activePanel.id, idx, val)}
                    panelId={activePanel.id}
                    roles={roles}
                  />
                )}
                {action === 'map' && activePanel && (
                  <LayoutWorkspace
                    panel={activePanel}
                    clients={activePanel.linkedClientId ? localClients.filter(c => c.id !== activePanel.linkedClientId) : localClients}
                    mappings={panelMappings[activePanel.id] || Array(activePanel.slotCount).fill(null)}
                    setMappings={(m: (MappedClient | null)[]) => setPanelMappings(prev => ({ ...prev, [activePanel.id]: m }))}
                    theme={theme}
                    linkedClientId={activePanel.linkedClientId}
                  />
                )}
              </div>
           </div>
        </div>
      )}
    </div>
  );
};

export default RemotePanelView;