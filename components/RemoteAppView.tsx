import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Mic, Radio, Settings, X, Image as ImageIcon } from 'lucide-react';
import { Client, MappedClient } from '../types';

interface RemoteAppViewProps {
  clients: Client[];
  updateClient?: (id: string, updates: Partial<Client>) => void;
  mappings: (MappedClient | null)[];
  theme: 'orange' | 'blue';
  panelName?: string;
  sharedStream1: MediaStream | null;
  sharedStream2: MediaStream | null;
  onTalkToggle?: (slotIdx: number, val: boolean) => void;
  panelId?: string;
  roles?: { id: string; label: string; color: string }[];
}

interface ContextMenu { x: number; y: number; slotIdx: number }

const RemoteAppView: React.FC<RemoteAppViewProps> = ({
  clients, updateClient, mappings, theme, panelName = 'STATION_ALPHA_PAD',
  sharedStream1, sharedStream2, onTalkToggle, panelId = 'default', roles = []
}) => {
  const [activeTalks, setActiveTalks] = useState<boolean[]>(new Array(64).fill(false));
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [availableMics, setAvailableMics] = useState<MediaDeviceInfo[]>([]);
  const [selectedMicId, setSelectedMicId] = useState<string>('');
  const [localMicLevel, setLocalMicLevel] = useState(-60);
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyzerRef = useRef<AnalyserNode | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingSlotRef = useRef<number>(-1);

  const storageKey = `easycom:remote:gains:${panelId}`;
  const imageKey = `easycom:remote:images:${panelId}`;

  const [slotGains, setSlotGains] = useState<Record<number, number>>(() => {
    try { return JSON.parse(localStorage.getItem(storageKey) ?? '{}') } catch { return {} }
  });
  const [slotImages, setSlotImages] = useState<Record<number, string>>(() => {
    try { return JSON.parse(localStorage.getItem(imageKey) ?? '{}') } catch { return {} }
  });

  useEffect(() => {
    try { localStorage.setItem(storageKey, JSON.stringify(slotGains)) } catch {}
  }, [slotGains]);

  useEffect(() => {
    try { localStorage.setItem(imageKey, JSON.stringify(slotImages)) } catch {}
  }, [slotImages]);

  const themeColor = theme === 'orange' ? 'orange' : 'blue';
  const accentHex = theme === 'orange' ? '#f97316' : '#3b82f6';

  useEffect(() => {
    navigator.mediaDevices.enumerateDevices().then(devices => {
      const ins = devices.filter(d => d.kind === 'audioinput');
      setAvailableMics(ins);
      if (ins.length && !selectedMicId) setSelectedMicId(ins[0].deviceId);
    }).catch(() => {});
  }, [selectedMicId]);

  useEffect(() => {
    const startMic = async () => {
      micStreamRef.current?.getTracks().forEach(t => t.stop());
      if (!selectedMicId) return;
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: selectedMicId } } });
        micStreamRef.current = stream;
        const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
        audioCtxRef.current = ctx;
        const analyzer = ctx.createAnalyser(); analyzer.fftSize = 256;
        ctx.createMediaStreamSource(stream).connect(analyzer);
        analyzerRef.current = analyzer;
        const update = () => {
          if (!analyzerRef.current) return;
          const data = new Uint8Array(analyzer.frequencyBinCount);
          analyzerRef.current.getByteFrequencyData(data);
          const avg = data.reduce((a, b) => a + b, 0) / data.length;
          setLocalMicLevel(avg > 0 ? (avg / 255) * 60 - 60 : -60);
          requestAnimationFrame(update);
        };
        update();
      } catch {}
    };
    startMic();
    return () => { micStreamRef.current?.getTracks().forEach(t => t.stop()); audioCtxRef.current?.close(); };
  }, [selectedMicId]);

  const handleTalkToggle = (idx: number, val: boolean) => {
    const mapping = mappings[idx];
    if (!mapping) return;
    const newActive = [...activeTalks];
    newActive[idx] = val;
    setActiveTalks(newActive);
    onTalkToggle?.(idx, val);
    if ((mapping as any).isGroupLatch) {
      const memberIds: string[] = (mapping as any).memberIds || [];
      if (updateClient) memberIds.forEach(id => updateClient(id, { isTalking: val }));
      return;
    }
    if (updateClient && mapping.id) updateClient(mapping.id, { isTalking: val });
  };

  const setGain = (idx: number, val: number) => {
    setSlotGains(prev => ({ ...prev, [idx]: val }));
  };

  const openImagePicker = (slotIdx: number) => {
    pendingSlotRef.current = slotIdx;
    setContextMenu(null);
    fileInputRef.current?.click();
  };

  const handleImageFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || pendingSlotRef.current < 0) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const dataUrl = ev.target?.result as string;
      setSlotImages(prev => ({ ...prev, [pendingSlotRef.current]: dataUrl }));
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const clearImage = (slotIdx: number) => {
    setSlotImages(prev => { const n = { ...prev }; delete n[slotIdx]; return n; });
    setContextMenu(null);
  };

  const handleContextMenu = (e: React.MouseEvent, slotIdx: number, isAssigned: boolean) => {
    if (!isAssigned) return;
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, slotIdx });
  };

  useEffect(() => {
    const close = () => setContextMenu(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, []);

  return (
    <div className="h-full bg-black flex flex-col selection:bg-none select-none overflow-hidden relative w-full">
      {/* hidden file input */}
      <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageFile} />

      {/* HEADER */}
      <div className="h-16 bg-zinc-900 border-b-2 border-black flex items-center justify-between px-6 shrink-0 z-[100]">
        <div className="flex items-center gap-6">
          <div className={`p-2 rounded bg-${themeColor}-600 shadow-lg`} style={{ boxShadow: `0 4px 12px ${accentHex}55, inset 0 1px 0 rgba(255,255,255,0.2), inset 0 -2px 0 rgba(0,0,0,0.4)` }}>
            <Radio size={20} className="text-white" />
          </div>
          <div className="flex flex-col">
            <span className="text-white font-black text-sm uppercase tracking-tighter italic leading-none">{panelName}</span>
            <span className="text-[9px] text-zinc-500 font-bold uppercase tracking-[0.3em] mt-1 italic">LOCAL_NETWORK_PEER</span>
          </div>
        </div>
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-4 bg-black/40 px-5 py-2 rounded-2xl border border-white/5">
            <Mic size={14} className={localMicLevel > -15 ? 'text-red-500' : 'text-zinc-500'} />
            <div className="h-2 w-24 bg-zinc-950 rounded-full overflow-hidden border border-white/5">
              <div className={`h-full transition-all duration-75 ${localMicLevel > -10 ? 'bg-red-500' : 'bg-green-500'}`}
                style={{ width: `${Math.max(2, (localMicLevel + 60) * 1.66)}%` }} />
            </div>
          </div>
          <button onClick={() => setIsSettingsOpen(true)} className="p-2 text-zinc-500 hover:text-white transition-all">
            <Settings size={22} />
          </button>
        </div>
      </div>

      {/* GRID */}
      <div className="flex-1 p-6 bg-zinc-950 overflow-y-auto">
        <div className="grid grid-cols-8 gap-3 w-full">
          {mappings.slice(0, 32).map((mapping, i) => {
            const isAssigned = !!mapping;
            const targetClient = mapping ? clients.find(c => c.id === mapping.id) : null;
            const isTalking = !!(targetClient?.isTalking || targetClient?.isLatched || activeTalks[i]);
            const gain = slotGains[i] ?? 100;
            const imgSrc = slotImages[i];
            const hasColor = !!(mapping?.color && mapping.color !== '' && mapping.color !== 'transparent');
            const bgColor = hasColor ? mapping!.color : '#27272a';
            const textScale = (mapping as any)?.textScale ?? 1;
            const role = targetClient?.customRole
              ? roles.find(r => r.id === targetClient.customRole)
              : undefined;

            return (
              <div key={i} className="flex flex-col gap-1">
                {/* BUTTON */}
                <div
                  onMouseDown={() => isAssigned && handleTalkToggle(i, true)}
                  onMouseUp={() => isAssigned && handleTalkToggle(i, false)}
                  onMouseLeave={() => isAssigned && activeTalks[i] && handleTalkToggle(i, false)}
                  onContextMenu={e => handleContextMenu(e, i, isAssigned)}
                  className={`relative aspect-square rounded-xl border-2 flex flex-col items-center justify-center overflow-hidden cursor-pointer transition-all duration-100 ${!isAssigned ? 'opacity-5 border-white/5' : ''}`}
                  style={{
                    background: imgSrc
                      ? `url(${imgSrc}) center/cover no-repeat`
                      : isAssigned ? bgColor : 'transparent',
                    borderColor: isTalking ? 'white' : isAssigned ? (hasColor ? mapping!.color : 'rgba(255,255,255,0.1)') : 'rgba(255,255,255,0.04)',
                    boxShadow: isTalking
                      ? `0 0 0 2px white, 0 0 30px 8px ${hasColor ? mapping!.color : 'rgba(255,255,255,0.6)'}88, inset 0 1px 0 rgba(255,255,255,0.3), inset 0 -2px 0 rgba(0,0,0,0.4)`
                      : isAssigned
                        ? 'inset 0 1px 0 rgba(255,255,255,0.15), inset 0 -2px 0 rgba(0,0,0,0.5), 0 2px 6px rgba(0,0,0,0.5)'
                        : 'none',
                  }}
                >
                  {imgSrc && <div className="absolute inset-0" style={{ background: isTalking ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.35)' }} />}
                  {isAssigned && (
                    <div className="relative z-10 flex flex-col items-center justify-center w-full px-1 gap-0.5">
                      {role && (
                        <span className="font-black uppercase tracking-widest leading-none"
                          style={{ fontSize: `${Math.round(7 * textScale)}px`, color: role.color || 'rgba(255,255,255,0.85)' }}>
                          {role.label}
                        </span>
                      )}
                      <span className="font-black text-white uppercase text-center drop-shadow-md leading-tight break-all"
                        style={{ fontSize: `${Math.round(12 * textScale)}px` }}>
                        {mapping!.name}
                      </span>
                    </div>
                  )}
                  {!isAssigned && (
                    <span style={{ fontSize: 8, color: 'rgba(255,255,255,0.06)' }}>{i + 1}</span>
                  )}
                </div>

                {/* GAIN SLIDER */}
                {isAssigned && (
                  <div className="flex items-center gap-1 px-0.5">
                    <input
                      type="range" min={0} max={150} value={gain}
                      onChange={e => setGain(i, Number(e.target.value))}
                      onMouseDown={e => e.stopPropagation()}
                      className="w-full h-0.5 appearance-none cursor-pointer rounded"
                      style={{ accentColor: hasColor ? mapping!.color : accentHex }}
                    />
                    <span className="text-[7px] font-mono text-zinc-600 w-5 shrink-0 text-right">{gain}</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* CONTEXT MENU */}
      {contextMenu && (
        <div
          className="fixed z-[5000] bg-zinc-800 border border-white/10 rounded-xl shadow-2xl py-1 min-w-[160px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={e => e.stopPropagation()}
        >
          <button
            onClick={() => openImagePicker(contextMenu.slotIdx)}
            className="w-full flex items-center gap-2 px-3 py-2 text-[11px] font-bold text-white hover:bg-white/10 transition-colors"
          >
            <ImageIcon size={12} /> Upload Image
          </button>
          {slotImages[contextMenu.slotIdx] && (
            <button
              onClick={() => clearImage(contextMenu.slotIdx)}
              className="w-full flex items-center gap-2 px-3 py-2 text-[11px] font-bold text-red-400 hover:bg-red-500/10 transition-colors"
            >
              <X size={12} /> Remove Image
            </button>
          )}
        </div>
      )}

      {/* SETTINGS */}
      {isSettingsOpen && (
        <div className="fixed inset-0 z-[5000] bg-black/90 backdrop-blur-xl flex items-center justify-center p-6">
          <div className="w-full max-w-lg bg-zinc-900 border border-white/10 rounded-[2.5rem] p-8 space-y-6">
            <h3 className="text-xl font-black text-white uppercase italic">Pad Settings</h3>
            <div className="space-y-4">
              <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Select Microphone</label>
              <select value={selectedMicId} onChange={e => setSelectedMicId(e.target.value)}
                className="w-full bg-black border border-white/10 rounded-xl p-4 text-xs font-black text-white">
                {availableMics.map(mic => <option key={mic.deviceId} value={mic.deviceId}>{mic.label || 'Mic'}</option>)}
              </select>
            </div>
            <button onClick={() => setIsSettingsOpen(false)}
              className={`w-full py-5 text-white font-black rounded-2xl uppercase`}
              style={{ background: accentHex, boxShadow: `0 4px 16px ${accentHex}55, inset 0 1px 0 rgba(255,255,255,0.2), inset 0 -2px 0 rgba(0,0,0,0.3)` }}>
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default RemoteAppView;
