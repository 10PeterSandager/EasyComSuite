import React, { useState, useEffect, useRef } from 'react';
import { Mic, Volume2, Settings, Radio, Power, User, Anchor, Activity, X, Keyboard, SlidersHorizontal, LayoutPanelTop, Edit3, Video, VideoOff, Maximize2, ChevronDown, Monitor, MousePointer2, Move, Link, Link2Off, Sliders, Settings2, Wifi, Lock, ShieldCheck, Globe } from 'lucide-react';
import { Client } from '../types';
import { initAudio } from '../client/webrtc/clientHandshake';

type MeterMode = 'standard' | 'compact' | 'minimal' | 'off';
type BridgeView = 'meters' | 'faders';

interface DesktopClientViewProps {
  hijackedClient?: Client;
  availableClients?: Client[];
  onUpdateRemote?: (updates: Partial<Client>) => void;
  onRelease?: () => void;
  sharedStream1: MediaStream | null;
  sharedStream2: MediaStream | null;
  theme: 'orange' | 'blue';
}

const DesktopClientView: React.FC<DesktopClientViewProps> = ({ 
  hijackedClient, availableClients = [], onUpdateRemote, onRelease, sharedStream1, sharedStream2, theme 
}) => {
  const [selectedClientId, setSelectedClientId] = useState(hijackedClient?.id || '');
  const [connected, setConnected] = useState(hijackedClient ? true : false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [code, setCode] = useState(hijackedClient?.code || '');
  const [clientName, setClientName] = useState(hijackedClient?.name || '');
  
  // Connection Settings
  const [hostIp, setHostIp] = useState(() => localStorage.getItem('easycom_desktop_host_ip') || '192.168.1.100');
  const [hostPort, setHostPort] = useState(() => localStorage.getItem('easycom_desktop_host_port') || '8080');
  const [encryptionKey, setEncryptionKey] = useState(() => localStorage.getItem('easycom_desktop_enc_key') || 'AES-256-EASY-COM');
  const [isNetSetupOpen, setIsNetSetupOpen] = useState(false);
  
  const activeClient = hijackedClient || availableClients.find(c => c.id === selectedClientId);
  const ifbNames = activeClient?.ifbNames || Array.from({ length: 8 }).map((_, i) => `IFB ${i + 1}`);

  // DESKTOP: Only Feed 2 is allowed
  const [showVideo2, setShowVideo2] = useState(false);
  const [videoScale, setVideoScale] = useState(100);
  
  const [isCinemaMode, setIsCinemaMode] = useState(false);
  const [pgm2Volume, setPgm2Volume] = useState(70);
  const [pgmLevels, setPgmLevels] = useState([-60, -60]);

  const videoRef2 = useRef<HTMLVideoElement>(null);
  const cinemaVideoRef = useRef<HTMLVideoElement>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  const [activePairIdx, setActivePairIdx] = useState<number | null>(null);
  const [activeTalks, setActiveTalks] = useState<boolean[]>(new Array(8).fill(false));
  const [latches, setLatches] = useState<boolean[]>(new Array(8).fill(false));

  const [keyMappings, setKeyMappings] = useState<(string | null)[]>(() => {
    const saved = localStorage.getItem('easycom_desktop_keybinds_v2');
    return saved ? JSON.parse(saved) : ['Space', 'KeyX', 'KeyC', 'KeyV', 'Digit1', 'Digit2', 'Digit3', 'Digit4'];
  });

  const [gains, setGains] = useState<number[]>(new Array(8).fill(80));
  const [pans, setPans] = useState<number[]>(new Array(8).fill(0));
  const [channelModes, setChannelModes] = useState<('mono' | 'stereo')[]>(['stereo', 'stereo', 'stereo', 'stereo']);
  const [levels, setLevels] = useState<number[]>(new Array(8).fill(-60));
  const [masterVolume, setMasterVolume] = useState(80);
  
  const [meterMode, setMeterMode] = useState<MeterMode>(() => {
    return (localStorage.getItem('easycom_desktop_meter_mode') as MeterMode) || 'standard';
  });
  
  const [bridgeView, setBridgeView] = useState<BridgeView>(() => {
    return (localStorage.getItem('easycom_desktop_bridge_view') as BridgeView) || 'meters';
  });

  const [activeSoundcard, setActiveSoundcard] = useState(() => {
    return localStorage.getItem('easycom_desktop_soundcard') || 'DANTE: Virtual Soundcard v4.2';
  });

  const [activeMappingIdx, setActiveMappingIdx] = useState<number | null>(null);

  useEffect(() => {
    localStorage.setItem('easycom_desktop_keybinds_v2', JSON.stringify(keyMappings));
    localStorage.setItem('easycom_desktop_soundcard', activeSoundcard);
    localStorage.setItem('easycom_desktop_meter_mode', meterMode);
    localStorage.setItem('easycom_desktop_bridge_view', bridgeView);
    localStorage.setItem('easycom_desktop_host_ip', hostIp);
    localStorage.setItem('easycom_desktop_host_port', hostPort);
    localStorage.setItem('easycom_desktop_enc_key', encryptionKey);
  }, [keyMappings, activeSoundcard, meterMode, bridgeView, hostIp, hostPort, encryptionKey]);

  useEffect(() => {
    if (hijackedClient) {
      setConnected(true);
      setClientName(hijackedClient.name);
      setCode(hijackedClient.code);
      setSelectedClientId(hijackedClient.id);
      setShowVideo2(hijackedClient.videoSources.includes(2));
    }
  }, [hijackedClient]);

  useEffect(() => {
    const interval = setInterval(() => {
      setLevels(prev => prev.map(() => -45 + Math.random() * 35));
    }, 120);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      if (sharedStream2) {
        setPgmLevels([-12 + Math.random() * 6, -12 + Math.random() * 6]);
      } else {
        setPgmLevels([-60, -60]);
      }
    }, 100);
    return () => clearInterval(interval);
  }, [sharedStream2]);

  useEffect(() => {
    if (isCinemaMode) return;
    if (videoRef2.current && sharedStream2 && showVideo2) {
      if (videoRef2.current.srcObject !== sharedStream2) {
        videoRef2.current.srcObject = sharedStream2;
        videoRef2.current.play().catch(e => console.warn("Video 2 Error:", e));
      }
    } else if (videoRef2.current) {
      videoRef2.current.srcObject = null;
    }
  }, [sharedStream2, showVideo2, isCinemaMode]);

  useEffect(() => {
    if (cinemaVideoRef.current && isCinemaMode) {
      if (cinemaVideoRef.current.srcObject !== sharedStream2) {
        cinemaVideoRef.current.srcObject = sharedStream2;
        if (sharedStream2) cinemaVideoRef.current.play().catch(e => console.warn("Cinema Video Error:", e));
      }
    }
  }, [sharedStream2, isCinemaMode]);

  useEffect(() => {
    if (!connected || isSettingsOpen || activeMappingIdx !== null) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return; 
      const idx = keyMappings.indexOf(e.code);
      if (idx !== -1) {
        e.preventDefault();
        if (!activeTalks[idx] && !latches[idx]) handleTalkToggle(idx, true);
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      const idx = keyMappings.indexOf(e.code);
      if (idx !== -1) handleTalkToggle(idx, false);
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [connected, isSettingsOpen, keyMappings, activeTalks, latches, activeMappingIdx]);

  // 🔥 Initialize WebRTC audio receive when client connects
  useEffect(() => {
    if (!connected || !selectedClientId) return
    console.log(`[DesktopClientView] connected as "${selectedClientId}" – initializing audio`)
    initAudio(selectedClientId)
  }, [connected, selectedClientId])

  useEffect(() => {
    if (activeMappingIdx === null) return;
    const handleCapture = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const newMappings = [...keyMappings];
      newMappings[activeMappingIdx] = e.code;
      setKeyMappings(newMappings);
      setActiveMappingIdx(null);
    };
    window.addEventListener('keydown', handleCapture, true);
    return () => window.removeEventListener('keydown', handleCapture, true);
  }, [activeMappingIdx, keyMappings]);

  const handleTalkToggle = (idx: number, val: boolean) => {
    const newActive = [...activeTalks];
    newActive[idx] = val;
    setActiveTalks(newActive);
    if (onUpdateRemote && idx === 0) onUpdateRemote({ isTalking: val || latches[0] });
  };

  const handleLatchToggle = (idx: number) => {
    const newLatches = [...latches];
    newLatches[idx] = !newLatches[idx];
    setLatches(newLatches);
    if (onUpdateRemote && idx === 0) onUpdateRemote({ isLatched: newLatches[idx] });
  };

  const handleMeterMouseDown = (pairIdx: number) => {
    longPressTimer.current = setTimeout(() => {
      setActivePairIdx(pairIdx);
    }, 600);
  };

  const handleMeterMouseUp = () => {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
  };

  const updateGain = (idx: number, val: number) => {
    const newGains = [...gains];
    newGains[idx] = val;
    const pairIdx = Math.floor(idx / 2);
    if (channelModes[pairIdx] === 'stereo') newGains[idx % 2 === 0 ? idx + 1 : idx - 1] = val;
    setGains(newGains);
    if (hijackedClient && idx === 0) onUpdateRemote?.({ gain: val });
  };

  const updatePan = (idx: number, val: number) => {
    const newPans = [...pans];
    newPans[idx] = val;
    const pairIdx = Math.floor(idx / 2);
    if (channelModes[pairIdx] === 'stereo') newPans[idx % 2 === 0 ? idx + 1 : idx - 1] = -val;
    setPans(newPans);
  };

  const themeColor = theme === 'orange' ? 'orange' : 'blue';

  if (!connected) {
    return (
      <div className="h-full flex items-center justify-center metallic-bg brushed-metal p-8">
        <div className="w-[450px] bg-[#0a0c10] border border-white/10 rounded-3xl shadow-[0_0_100px_rgba(0,0,0,1)] flex flex-col p-10 bevel no-active relative overflow-hidden">
           <div className={`absolute top-0 left-0 w-full h-1 bg-${themeColor}-600 shadow-[0_0_15px_rgba(234,88,12,0.5)]`} />
           <div className="flex flex-col items-center gap-6 mb-12">
              <div className={`w-20 h-20 bg-${themeColor}-600 rounded-2xl flex items-center justify-center shadow-xl shadow-${themeColor}-900/40 bevel no-active relative`}>
                <Radio size={40} className="text-white" />
                <button onClick={() => setIsNetSetupOpen(true)} className="absolute -top-2 -right-2 p-2.5 bg-zinc-800 border border-white/10 rounded-full text-zinc-400 hover:text-white shadow-xl transition-all active:scale-90"><Settings size={16} /></button>
              </div>
              <div className="text-center">
                <h2 className="text-2xl font-black text-white tracking-tighter italic uppercase">Desktop Station</h2>
                <p className="text-[10px] text-zinc-500 font-black uppercase tracking-[0.3em] mt-2 italic">Broadcast Intercom Terminal</p>
              </div>
           </div>
           <div className="space-y-4">
              <div className="relative group">
                <User className={`absolute left-4 top-4 text-zinc-600 group-focus-within:text-${themeColor}-500 transition-colors pointer-events-none`} size={18} />
                <select value={selectedClientId} onChange={(e) => { setSelectedClientId(e.target.value); const client = availableClients.find(c => c.id === e.target.value); if (client) setClientName(client.name); }} className={`w-full bg-black border border-white/10 rounded-xl px-12 py-4 text-xs font-black text-white focus:border-${themeColor}-500 outline-none appearance-none transition-all bevel-inset no-active uppercase`}>
                  <option value="" disabled>Select Desktop Station</option>
                  {availableClients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <ChevronDown className="absolute right-4 top-4 text-zinc-600 pointer-events-none" size={18} />
              </div>
              <input placeholder="4-DIGIT PIN" maxLength={4} value={code} onChange={(e) => setCode(e.target.value)} className={`w-full bg-black border border-white/10 rounded-xl px-12 py-4 text-sm font-black text-white focus:border-${themeColor}-500 outline-none mono text-center tracking-[0.8em] bevel-inset no-active`} />
              
              <div className="pt-2 space-y-4">
                <button onClick={() => selectedClientId && setConnected(true)} className={`w-full bg-${themeColor}-600 text-white font-black py-5 rounded-xl shadow-2xl active:scale-95 transition-all uppercase text-xs tracking-[0.4em] bevel`}>Establish Link</button>
                <button onClick={() => setIsNetSetupOpen(true)} className="w-full bg-zinc-800/60 border border-white/5 text-zinc-400 font-black py-4 rounded-xl active:scale-95 transition-all uppercase text-[10px] tracking-[0.2em] bevel flex items-center justify-center gap-2">
                  <Settings2 size={16} /> Connection Setup
                </button>
              </div>
           </div>
           {isNetSetupOpen && (
             <div className="absolute inset-0 z-[150] bg-zinc-950/98 backdrop-blur-2xl p-10 flex flex-col animate-in slide-in-from-bottom duration-300">
                <div className="flex justify-between items-center mb-10 shrink-0">
                   <div className="flex items-center gap-4">
                      <div className={`p-3 bg-${themeColor}-600 rounded-xl shadow-xl shadow-${themeColor}-950/40`}><Wifi size={24} className="text-white" /></div>
                      <h3 className="text-white font-black uppercase text-lg italic tracking-tighter">Connection Settings</h3>
                   </div>
                   <button onClick={() => setIsNetSetupOpen(false)} className="p-4 bg-zinc-900 border border-white/10 rounded-full text-zinc-400 hover:text-white bevel transition-all"><X size={24}/></button>
                </div>
                <div className="space-y-8 flex-1 overflow-auto custom-scrollbar pr-2">
                   <div className="space-y-3">
                      <label className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.2em] ml-1">Master Host IP Address</label>
                      <input value={hostIp} onChange={(e) => setHostIp(e.target.value)} className="w-full bg-black border border-white/10 rounded-xl p-5 text-sm font-black text-white focus:border-blue-500 outline-none mono bevel-inset no-active" />
                   </div>
                   <div className="space-y-3">
                      <label className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.2em] ml-1">Network Access Port</label>
                      <input type="number" value={hostPort} onChange={(e) => setHostPort(e.target.value)} className="w-full bg-black border border-white/10 rounded-xl p-5 text-sm font-black text-white focus:border-blue-500 outline-none mono bevel-inset no-active" />
                   </div>
                   <div className="space-y-3">
                      <label className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.2em] ml-1">AES-256 Encryption Token</label>
                      <input type="password" value={encryptionKey} onChange={(e) => setEncryptionKey(e.target.value)} className="w-full bg-black border border-white/10 rounded-xl p-5 text-sm font-black text-zinc-400 focus:border-blue-500 outline-none mono bevel-inset no-active" />
                   </div>
                </div>
                <button onClick={() => setIsNetSetupOpen(false)} className={`w-full py-6 bg-${themeColor}-600 text-white font-black rounded-2xl shadow-2xl mt-10 uppercase text-xs tracking-[0.4em] bevel`}>Save & Close</button>
             </div>
           )}
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col metallic-bg p-6 overflow-hidden relative">
      <div className="max-w-[1400px] mx-auto w-full h-full flex flex-col bg-[#0a0c10] border border-white/10 rounded-3xl shadow-[0_0_100px_rgba(0,0,0,0.8)] overflow-hidden relative bevel no-active">
        <div className="h-20 bg-zinc-900 border-b border-white/10 flex items-center justify-between px-6 shrink-0 z-20">
          <div className="flex items-center gap-4"><div className={`bg-${themeColor}-600 p-2 rounded-lg shadow-lg bevel no-active`}><Radio size={20} className="text-white" /></div><div><h2 className="text-sm font-black text-white uppercase tracking-tighter italic">{clientName}</h2><p className="text-[9px] text-zinc-500 font-bold uppercase tracking-[0.2em]">NODE: {hostIp}:{hostPort}</p></div></div>
          
          <div className="flex items-center gap-6 px-6 py-2 bg-black/20 rounded-2xl border border-white/5 mx-2">
             <div className="flex items-center gap-3">
               <div className="flex flex-col items-center">
                 <Move size={12} className="text-zinc-500" />
                 <span className="text-[7px] font-black text-zinc-600 uppercase">V-SIZE</span>
               </div>
               <input type="range" min="50" max="180" value={videoScale} onChange={(e) => setVideoScale(parseInt(e.target.value))} className={`w-24 h-1 bg-zinc-800 rounded-full appearance-none ${theme === 'orange' ? 'orange-thumb' : 'blue-thumb'} cursor-pointer`} />
               <span className="text-[9px] font-mono text-zinc-500 w-8">{videoScale}%</span>
             </div>
          </div>

          <div className="flex items-center gap-2">
            <button onClick={() => setIsEditMode(!isEditMode)} className={`flex items-center gap-2 px-3 py-1.5 rounded-lg bevel no-active shadow-lg transition-all ${isEditMode ? `bg-yellow-600 text-white` : 'bg-zinc-800 text-zinc-500'}`}><Edit3 size={14} /><span className="text-[9px] font-black uppercase tracking-widest">{isEditMode ? 'Done' : 'Edit Mapping'}</span></button>
            <button disabled className="flex items-center gap-2 px-3 py-1.5 rounded-lg bevel no-active shadow-lg bg-zinc-900/50 text-zinc-700 cursor-not-allowed opacity-20"><Video size={14} /><span className="text-[9px] font-black uppercase tracking-widest">Feed 1 Locked</span></button>
            <button onClick={() => setShowVideo2(!showVideo2)} disabled={activeClient && !activeClient.videoSources.includes(2)} className={`flex items-center gap-2 px-3 py-1.5 rounded-lg bevel no-active shadow-lg transition-all ${showVideo2 ? 'bg-blue-600 text-white' : 'bg-zinc-800 text-zinc-500'} disabled:opacity-20`}><Video size={14} /><span className="text-[9px] font-black uppercase tracking-widest">Feed 2</span></button>
            <button onClick={() => setIsSettingsOpen(true)} className={`p-2 rounded-lg transition-all ${isSettingsOpen ? `bg-${themeColor}-600 text-white` : 'text-zinc-500 hover:text-white'}`}><Settings size={20} /></button>
            <button onClick={() => hijackedClient ? onRelease?.() : setConnected(false)} className="p-2 text-zinc-500 hover:text-red-500 transition-all"><Power size={20} /></button>
          </div>
        </div>

        <div className="flex-1 flex flex-col p-8 overflow-auto custom-scrollbar bg-black/20">
          <div className="mb-6 w-full flex justify-center animate-in slide-in-from-top duration-500 shrink-0">
             {showVideo2 && (
               <div className={`relative aspect-video bg-black rounded-none border-2 overflow-hidden transition-all shadow-xl ${(activeTalks[0] || latches[0]) ? `border-${themeColor}-500 ring-4 ring-${themeColor}-500/20` : 'border-blue-500/50'}`} style={{ width: `${350 * (videoScale / 100)}px`, maxWidth: '100%' }}>
                  {sharedStream2 ? <video ref={videoRef2} autoPlay playsInline muted className="w-full h-full object-cover" /> : <div className="w-full h-full bg-zinc-950 flex flex-col items-center justify-center gap-4"><VideoOff size={32} className="text-zinc-900 animate-pulse" /><span className="text-[9px] font-black text-zinc-800 uppercase tracking-[0.4em]">SIGNAL_IDLE</span></div>}
                  <div className="absolute bottom-2 right-3"><button onClick={() => setIsCinemaMode(true)} className="p-1 bg-black/40 rounded-full text-white/40 hover:text-white transition-all backdrop-blur-sm"><Maximize2 size={10} /></button></div>
                  <div className="absolute top-2 left-3 flex items-center gap-1.5"><div className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" /><span className="text-[7px] font-black text-white/60 uppercase tracking-widest">PGM 02</span></div>
               </div>
             )}
          </div>
          <div className="grid grid-cols-4 grid-rows-2 gap-4 flex-1 items-stretch">
             {ifbNames.map((name, idx) => {
                const isTalking = activeTalks[idx] || latches[idx];
                return (
                  <div key={idx} className={`relative rounded-[2rem] border-2 transition-all duration-300 flex flex-col items-center justify-center p-6 shadow-xl bevel no-active ${isTalking ? `bg-${themeColor}-600/20 border-${themeColor}-500 shadow-[0_0_50px_rgba(${theme === 'orange' ? '234,88,12' : '37,99,235'},0.3)]` : isEditMode ? 'bg-zinc-800/40 border-yellow-500/30' : 'bg-zinc-900/40 border-white/5'}`}>
                    <div className={`w-14 h-14 rounded-full flex items-center justify-center mb-4 ${isTalking ? `bg-${themeColor}-600 shadow-xl scale-110` : 'bg-zinc-800 text-zinc-700'}`}><Mic size={24} className={isTalking ? 'text-white' : 'text-zinc-700'} /></div>
                    {isEditMode ? (
                      <button onClick={() => setActiveMappingIdx(idx)} className={`w-full py-1.5 rounded-lg border text-[8px] font-black uppercase flex items-center justify-center gap-1.5 transition-all ${keyMappings[idx] ? 'bg-zinc-700 text-yellow-500 border-yellow-500/30' : 'bg-red-950/20 text-red-500 border-red-500/20'}`}><Keyboard size={10} /> {keyMappings[idx] ? keyMappings[idx]?.replace('Key', '').replace('Digit', '') : 'Map Key'}</button>
                    ) : (
                      <>
                        <button onMouseDown={() => !latches[idx] && handleTalkToggle(idx, true)} onMouseUp={() => !latches[idx] && handleTalkToggle(idx, false)} onClick={() => latches[idx] && handleLatchToggle(idx)} className={`w-full py-4 rounded-2xl text-[11px] font-black uppercase tracking-widest transition-all bevel ${isTalking ? `bg-${themeColor}-600 text-white` : 'bg-zinc-800 text-zinc-500'}`}>{name}</button>
                        {keyMappings[idx] && <span className="absolute bottom-4 text-[8px] font-black text-zinc-700 uppercase tracking-widest">{keyMappings[idx]?.replace('Key', '').replace('Digit', '').replace('Space', 'SPC')}</span>}
                        <button onClick={() => handleLatchToggle(idx)} className={`absolute top-4 right-4 p-2.5 rounded-xl border transition-all bevel no-active ${latches[idx] ? `bg-white text-${themeColor}-600 shadow-xl` : 'bg-black/40 border-white/10 text-zinc-700'}`}><Anchor size={12} /></button>
                      </>
                    )}
                  </div>
                );
             })}
          </div>
        </div>
      </div>
      {isCinemaMode && <div className="absolute inset-0 z-[1000] bg-black flex flex-col animate-in fade-in zoom-in duration-300"><div className="flex-1 relative flex items-center justify-center"><div className="w-full h-full max-w-full aspect-video bg-black flex items-center justify-center">{sharedStream2 ? <video ref={cinemaVideoRef} autoPlay playsInline muted className="w-full h-full object-contain" /> : <div className="text-zinc-800 text-xs font-black uppercase tracking-widest">SIGNAL DROPPED</div>}</div><button onClick={() => setIsCinemaMode(false)} className="absolute top-12 right-12 p-4 bg-zinc-900 border border-white/10 text-white rounded-full"><X size={24} /></button></div></div>}
    </div>
  );
};

export default DesktopClientView;