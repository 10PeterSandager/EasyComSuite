import React, { useState, useEffect, useRef } from 'react';
import { Mic, PhoneOff, Settings, Volume2, User, Key, Lock, Radio, Activity, Speaker, X, Anchor, SlidersHorizontal, ChevronRight, RotateCcw, Save, Trash2, Edit3, UserCheck, Layers, Headphones, Link, RefreshCw, Video, VideoOff, Maximize2, Minimize2, AlertCircle, LogOut, Music, Globe, ChevronDown, Network, MessageSquareShare, Zap, Wifi, ShieldCheck, Link2, Settings2, Split, Sliders, Type, GripVertical } from 'lucide-react';
import { Client } from '../types';

import { initAudio } from '../client/webrtc/clientHandshake';
import { audioCtx, socket, setReceiverGain, setPanForChannel, setStereoPairs, startLevelMeter, subscribeToReceivedChannelLevels } from '../client/webrtc/intercom';
import { produceStream, stopProducing } from '../client/webrtc/mediasoupClient';
import { startStereoTestTone, stopStereoTestTone } from '../client/audio/AudioBridge';
interface MobileClientViewProps {
  hijackedClient?: Client;
  availableClients?: Client[];
  onUpdateRemote?: (updates: Partial<Client>) => void;
  onRelease?: () => void;
  theme: 'orange' | 'blue';
  sharedStream1: MediaStream | null;
  sharedStream2: MediaStream | null;
}

const MobileClientView: React.FC<MobileClientViewProps> = ({ 
  hijackedClient, availableClients = [], onUpdateRemote, onRelease, theme,
  sharedStream1, sharedStream2
}) => {
  const [selectedClientId, setSelectedClientId] = useState(hijackedClient?.id || '');
  const [connected, setConnected] = useState(hijackedClient ? true : false);
  const [code, setCode] = useState(hijackedClient?.code || '');
  
  const [hostIp, setHostIp] = useState(() => localStorage.getItem('easycom_mobile_host_ip') || '192.168.1.100');
  const [hostPort, setHostPort] = useState(() => localStorage.getItem('easycom_mobile_host_port') || '8080');
  const [encryptionKey, setEncryptionKey] = useState(() => localStorage.getItem('easycom_mobile_enc_key') || 'AES-256-EASY-COM');
  const [sessionPassword, setSessionPassword] = useState(() => localStorage.getItem('easycom_mobile_session_pw') || '');
  const [isNetSetupOpen, setIsNetSetupOpen] = useState(false);
  
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isActualMobile, setIsActualMobile] = useState(false);
  
  const activeClient = hijackedClient || availableClients.find(c => c.id === selectedClientId);
  
  const [backtalkEnabled, setBacktalkEnabled] = useState(() => localStorage.getItem('easycom_mobile_backtalk') === 'true');
  const [backtalkAudioMode, setBacktalkAudioMode] = useState<'1' | '1+2'>(() => (localStorage.getItem('easycom_mobile_bt_audio') as '1' | '1+2') || '1+2');
  
  const [talkNames, setTalkNames] = useState(['Talk 1', 'Talk 2', 'Talk 3', 'Talk 4', 'Talk 5', 'Talk 6', 'Talk 7', 'Talk 8']);

  const [recvLevels, setRecvLevels] = useState<Record<number, number>>({})

  // TBV State: 4-way split mode
  const [isTBVActive, setIsTBVActive] = useState(hijackedClient?.isTBVActive || false);
  const [tbActive, setTbActive] = useState<boolean[]>(hijackedClient?.tbActive || new Array(8).fill(false));
  const [latches, setLatches] = useState<boolean[]>(new Array(8).fill(false));

  // Per-channel gain and pan — persisted to localStorage
  // Pan defaults: odd channels → L (-50), even channels → R (+50)
  const [gains, setGains] = useState<number[]>(() => {
    try { const s = localStorage.getItem('easycom_ch_gains'); return s ? JSON.parse(s) : new Array(8).fill(80) } catch { return new Array(8).fill(80) }
  });
  const [pans, setPans] = useState<number[]>(() => {
    try { const s = localStorage.getItem('easycom_ch_pans_v2'); return s ? JSON.parse(s) : new Array(8).fill(0) } catch { return new Array(8).fill(0) }
  });

  // Video Monitoring Volumes
  const [videoVolume1, setVideoVolume1] = useState(() => parseInt(localStorage.getItem('easycom_mobile_vvol1') || '75'));
  const [videoVolume2, setVideoVolume2] = useState(() => parseInt(localStorage.getItem('easycom_mobile_vvol2') || '75'));

  useEffect(() => {
    if (activeClient) {
      const names = [...activeClient.ifbNames];
      while (names.length < 8) names.push(`Channel ${names.length + 1}`);
      setTalkNames(names);
      if (activeClient.inputGains) setGains(activeClient.inputGains);
    }
  }, [activeClient?.id]);

  const [showVideo1, setShowVideo1] = useState(false);
  const [showVideo2, setShowVideo2] = useState(false);
  const [isVideoExpanded, setIsVideoExpanded] = useState(false);
  const [expandedSource, setExpandedSource] = useState<1 | 2>(1);
  
  const themeColor = theme === 'orange' ? 'orange' : 'blue';
  const videoRef1 = useRef<HTMLVideoElement>(null);
  const videoRef2 = useRef<HTMLVideoElement>(null);
  const expandedVideoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => subscribeToReceivedChannelLevels(setRecvLevels), [])

  useEffect(() => {
    localStorage.setItem('easycom_mobile_backtalk', backtalkEnabled.toString());
    if (!backtalkEnabled && onUpdateRemote) onUpdateRemote({ isBacktalkActive: false });
  }, [backtalkEnabled]);

  useEffect(() => {
    localStorage.setItem('easycom_mobile_bt_audio', backtalkAudioMode);
  }, [backtalkAudioMode]);

  useEffect(() => { localStorage.setItem('easycom_ch_gains', JSON.stringify(gains)) }, [gains]);
  useEffect(() => { localStorage.setItem('easycom_ch_pans_v2', JSON.stringify(pans)) }, [pans]);

  useEffect(() => {
    localStorage.setItem('easycom_mobile_vvol1', videoVolume1.toString());
    if (videoRef1.current) videoRef1.current.volume = videoVolume1 / 100;
  }, [videoVolume1]);

  useEffect(() => {
    localStorage.setItem('easycom_mobile_vvol2', videoVolume2.toString());
    if (videoRef2.current) videoRef2.current.volume = videoVolume2 / 100;
  }, [videoVolume2]);

  useEffect(() => {
    if (hijackedClient) {
      setConnected(true);
      setSelectedClientId(hijackedClient.id);
      setShowVideo1(hijackedClient.videoSources.includes(1));
      setShowVideo2(hijackedClient.videoSources.includes(2));
      setIsTBVActive(hijackedClient.isTBVActive || false);
      setTbActive(hijackedClient.tbActive || new Array(8).fill(false));
      setLatches(new Array(8).fill(false).map((_, i) => (i === 0 ? hijackedClient.isLatched : false)));
    }
  }, [hijackedClient]);

  // 🔥 Initialize WebRTC audio receive when client connects
  useEffect(() => {
    if (!connected || !selectedClientId) return
    console.log(`[MobileClientView] connected as "${selectedClientId}" – initializing audio`)
    const clientName = availableClients.find(c => c.id === selectedClientId)?.name || selectedClientId
    socket.emit("client:register", { id: selectedClientId, name: clientName, type: "mobile" }, () => {})
    setStereoPairs([])  // cleared on connect; pairs are added dynamically via bridge:stereo:available
    initAudio(selectedClientId)
    gains.forEach((g, i) => setReceiverGain(i + 1, g / 100))
    pans.forEach((p, i) => setPanForChannel(i + 1, p / 50))

    // 🔥 Re-register on socket reconnect (e.g. after AirPods connect/disconnect)
    // Server will send targeted routing:update so consumers are re-established
    const handleReconnect = () => {
      console.log(`[MobileClientView] socket reconnected – re-registering "${selectedClientId}"`)
      socket.emit("client:register", { id: selectedClientId, name: clientName, type: "mobile" }, () => {})
      audioCtx.resume().catch(() => {})
    }
    socket.on("connect", handleReconnect)
    return () => { socket.off("connect", handleReconnect) }
  }, [connected, selectedClientId])


  // Video stream attachment logic
  useEffect(() => {
    const attachStreams = () => {
      if (videoRef1.current && showVideo1 && !isVideoExpanded) {
        if (videoRef1.current.srcObject !== sharedStream1) {
          videoRef1.current.srcObject = sharedStream1;
          videoRef1.current.volume = videoVolume1 / 100;
          if (sharedStream1) videoRef1.current.play().catch(() => {});
        }
      }
      if (videoRef2.current && showVideo2 && !isVideoExpanded) {
        if (videoRef2.current.srcObject !== sharedStream2) {
          videoRef2.current.srcObject = sharedStream2;
          videoRef2.current.volume = videoVolume2 / 100;
          if (sharedStream2) videoRef2.current.play().catch(() => {});
        }
      }
    };
    attachStreams();
  }, [showVideo1, showVideo2, sharedStream1, sharedStream2, isVideoExpanded, videoVolume1, videoVolume2]);

  useEffect(() => {
    if (expandedVideoRef.current && isVideoExpanded) {
      const stream = expandedSource === 1 ? sharedStream1 : sharedStream2;
      const vol = expandedSource === 1 ? videoVolume1 : videoVolume2;
      if (expandedVideoRef.current.srcObject !== stream) {
        expandedVideoRef.current.srcObject = stream;
        expandedVideoRef.current.volume = vol / 100;
        if (stream) expandedVideoRef.current.play().catch(() => {});
      }
    }
  }, [isVideoExpanded, expandedSource, sharedStream1, sharedStream2, videoVolume1, videoVolume2]);

  useEffect(() => {
    const checkMobile = () => setIsActualMobile(window.innerWidth < 640 || /iPhone|iPad|iPod|Android/i.test(navigator.userAgent));
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Mic stream held for the duration of any active TB press
  const micStreamRef = useRef<MediaStream | null>(null)
  const stopLevelMeterRef = useRef<(() => void) | null>(null)
  const toneCtxRef = useRef<AudioContext | null>(null)
  const toneOscRef = useRef<OscillatorNode | null>(null)
  const [toneActive, setToneActive] = useState(false)
  const toneActiveRef = useRef(false)
  const [stereoTestActive, setStereoTestActive] = useState(false)

  const stopToneResources = () => {
    if (toneOscRef.current) { try { toneOscRef.current.stop() } catch {} toneOscRef.current = null }
    toneCtxRef.current?.close(); toneCtxRef.current = null
  }

  // Start mic or tone + WebRTC producer if not already running
  const ensureMicProducer = async () => {
    if (hijackedClient) return
    if (micStreamRef.current) return
    if (toneActiveRef.current) {
      try {
        const ctx = new AudioContext()
        await ctx.resume()
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        const dest = ctx.createMediaStreamDestination()
        osc.type = 'sine'; osc.frequency.value = 1000; gain.gain.value = 0.3
        osc.connect(gain); gain.connect(dest); osc.start()
        toneCtxRef.current = ctx; toneOscRef.current = osc
        micStreamRef.current = dest.stream
        await produceStream(dest.stream)
      } catch (e) { console.error('[MobileClientView] tone start failed:', e) }
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
      micStreamRef.current = stream
      stopLevelMeterRef.current = startLevelMeter(stream, selectedClientId)
      await produceStream(stream)
    } catch (e) { console.error('[MobileClientView] mic start failed:', e) }
  }

  // Stop mic/tone when all TB channels are inactive
  const stopMicIfIdle = (nextTbActive: boolean[]) => {
    if (hijackedClient) return
    if (nextTbActive.some(Boolean)) return
    stopLevelMeterRef.current?.(); stopLevelMeterRef.current = null
    stopProducing()
    micStreamRef.current?.getTracks().forEach(t => t.stop())
    micStreamRef.current = null
    stopToneResources()
  }

  const handleToneToggle = async () => {
    const next = !toneActive
    setToneActive(next); toneActiveRef.current = next
    if (!hijackedClient && tbActive.some(Boolean)) {
      stopProducing()
      micStreamRef.current?.getTracks().forEach(t => t.stop())
      micStreamRef.current = null
      stopToneResources()
      await ensureMicProducer()
    }
  }

  // Clean up mic/tone on unmount
  useEffect(() => () => {
    if (!hijackedClient && micStreamRef.current) {
      stopLevelMeterRef.current?.(); stopLevelMeterRef.current = null
      stopProducing()
      micStreamRef.current.getTracks().forEach(t => t.stop())
      micStreamRef.current = null
      stopToneResources()
    }
  }, [])

  const handleTalkToggle = async (idx: number, val: boolean) => {
    const newTbActive = [...tbActive];
    newTbActive[idx] = val;
    setTbActive(newTbActive);
    if (hijackedClient) {
      onUpdateRemote?.({ tbActive: newTbActive });
      if (idx === 0) onUpdateRemote?.({ isTalking: val || latches[0] });
    } else {
      if (val) await ensureMicProducer()
      socket.emit("client:talking", { isTalking: val, channel: idx + 1 })
      stopMicIfIdle(newTbActive)
    }
  };

  const handleLatchToggle = async (idx: number) => {
    const newLatches = [...latches];
    newLatches[idx] = !newLatches[idx];
    setLatches(newLatches);
    const newTbActive = [...tbActive];
    newTbActive[idx] = newLatches[idx];
    setTbActive(newTbActive);
    if (hijackedClient) {
      onUpdateRemote?.({ tbActive: newTbActive });
      if (idx === 0) onUpdateRemote?.({ isLatched: newLatches[0], isTalking: newLatches[0] });
    } else {
      if (newLatches[idx]) await ensureMicProducer()
      socket.emit("client:talking", { isTalking: newLatches[idx], channel: idx + 1 })
      socket.emit("client:latched", { isLatched: newLatches[idx] })
      stopMicIfIdle(newTbActive)
    }
  };

  const handleBacktalkToggle = (val: boolean) => {
    if (backtalkEnabled) {
      const newTbActive = [...tbActive];
      newTbActive[0] = val;
      newTbActive[1] = backtalkAudioMode === '1+2' ? val : false;
      setTbActive(newTbActive);
      if (hijackedClient) {
        onUpdateRemote?.({ isBacktalkActive: val, isTalking: val, tbActive: newTbActive });
      } else {
        if (val) ensureMicProducer()
        socket.emit("client:talking", { isTalking: val, channel: 1 })
        if (backtalkAudioMode === '1+2') socket.emit("client:talking", { isTalking: val, channel: 2 })
        stopMicIfIdle(newTbActive)
      }
    } else {
      handleTalkToggle(1, val);
    }
  };

  const handleTBVToggle = () => {
    const newState = !isTBVActive;
    setIsTBVActive(newState);
    if (onUpdateRemote) onUpdateRemote({ isTBVActive: newState });
  };

  const handleNameSaveLocal = (idx: number, name: string) => {
    const newNames = [...talkNames];
    newNames[idx] = name;
    setTalkNames(newNames);
    if (onUpdateRemote && activeClient) {
      const newIfbNames = [...activeClient.ifbNames];
      newIfbNames[idx] = name;
      onUpdateRemote({ ifbNames: newIfbNames });
    }
  };

  const isActuallyTalking = (idx: number) => tbActive[idx] || latches[idx];

  const handleDisconnect = () => {
    setConnected(false);
    setSelectedClientId('');
    setCode('');
    setIsSettingsOpen(false);
    if (onRelease) onRelease();
  };

  const updateGain = (chIdx: number, val: number) => {
    const newGains = [...gains];
    newGains[chIdx] = val;
    setGains(newGains);
    setReceiverGain(chIdx + 1, val / 100);
    if (onUpdateRemote) onUpdateRemote({ inputGains: newGains });
  };

  const updatePan = (chIdx: number, val: number) => {
    const newPans = [...pans];
    newPans[chIdx] = val;
    setPans(newPans);
    setPanForChannel(chIdx + 1, val / 50);
  };

  if (!connected) {
    return (
      <div className={`flex items-center justify-center h-full bg-[#050505] ${isActualMobile ? 'p-0' : 'p-4'}`}>
        <div className={`${isActualMobile ? 'w-full h-full rounded-none border-0' : 'w-[300px] aspect-[9/19] rounded-[2.5rem] border-[8px] border-zinc-800'} bg-zinc-900 relative overflow-hidden flex flex-col p-6 shadow-2xl`}>
           <div className="mt-16 flex flex-col items-center gap-4">
              <div className="w-16 h-16 bg-blue-600 rounded-2xl flex items-center justify-center shadow-xl bevel no-active relative">
                 <Radio size={32} className="text-white" />
                 <button onClick={() => setIsNetSetupOpen(true)} className="absolute -top-2 -right-2 p-2 bg-zinc-800 border border-white/10 rounded-full text-zinc-400 hover:text-white shadow-xl transition-all active:scale-90"><Settings size={14} /></button>
              </div>
              <div className="text-center">
                <h2 className="text-lg font-black text-white uppercase italic tracking-tighter">EasyCom Mobile</h2>
                <p className="text-[10px] text-zinc-500 uppercase font-bold tracking-[0.3em] mt-1">Intercom Terminal</p>
              </div>
           </div>
           <div className="mt-12 space-y-4">
              <div className="relative">
                <select value={selectedClientId} onChange={(e) => setSelectedClientId(e.target.value)} className="w-full bg-black border border-white/10 rounded-xl px-4 py-4 text-xs font-black text-white focus:border-blue-500 outline-none appearance-none bevel-inset no-active uppercase">
                  <option value="" disabled>Select Client</option>
                  {availableClients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <ChevronDown size={14} className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-600 pointer-events-none" />
              </div>
              <input placeholder="4-Digit Code" maxLength={4} value={code} onChange={(e) => setCode(e.target.value)} className="w-full bg-black border border-white/10 rounded-xl px-4 py-4 text-xs text-white focus:border-blue-500 outline-none mono text-center tracking-[0.6em] font-black bevel-inset no-active" />
              <div className="space-y-3 mt-4">
                <button onClick={() => { if (!selectedClientId) return; audioCtx.resume().catch(() => {}); setConnected(true) }} className="w-full bg-blue-600 text-white font-black py-5 rounded-xl shadow-lg active:scale-95 transition-all uppercase text-xs tracking-[0.2em] bevel">Connect Link</button>
                <button onClick={() => setIsNetSetupOpen(true)} className="w-full bg-zinc-800/60 border border-white/5 text-zinc-400 font-black py-4 rounded-xl active:scale-95 transition-all uppercase text-[10px] tracking-[0.2em] bevel flex items-center justify-center gap-2"><Settings2 size={14} /> Connection Setup</button>
              </div>
           </div>
           {isNetSetupOpen && (
             <div className="absolute inset-0 z-[150] bg-zinc-950/98 backdrop-blur-2xl p-8 flex flex-col animate-in slide-in-from-bottom duration-300">
                <div className="flex justify-between items-center mb-8 shrink-0">
                   <div className="flex items-center gap-3"><div className="p-2 bg-blue-600 rounded-lg shadow-lg"><Wifi size={16} className="text-white" /></div><h3 className="text-white font-black uppercase text-sm italic tracking-tighter">Connection Settings</h3></div>
                   <button onClick={() => setIsNetSetupOpen(false)} className="p-3 bg-zinc-900 rounded-full text-zinc-400 bevel"><X size={18}/></button>
                </div>
                <div className="space-y-6 flex-1 overflow-auto">
                   <div className="space-y-2"><label className="text-[9px] font-black text-zinc-500 uppercase tracking-widest ml-1">Server IP / Hostname</label><input value={hostIp} onChange={(e) => setHostIp(e.target.value)} className="w-full bg-black border border-white/10 rounded-xl p-4 text-xs font-black text-white outline-none mono bevel-inset no-active" placeholder="192.168.1.23 or easycomserver.duckdns.org" /></div>
                   <div className="space-y-2"><label className="text-[9px] font-black text-zinc-500 uppercase tracking-widest ml-1">Port</label><input type="number" value={hostPort} onChange={(e) => setHostPort(e.target.value)} className="w-full bg-black border border-white/10 rounded-xl p-4 text-xs font-black text-white outline-none mono bevel-inset no-active" /></div>
                   <div className="space-y-2"><label className="text-[9px] font-black text-zinc-500 uppercase tracking-widest ml-1">Session Password</label><input type="password" value={sessionPassword} onChange={(e) => setSessionPassword(e.target.value)} placeholder="Leave empty if none" className="w-full bg-black border border-white/10 rounded-xl px-4 py-4 text-xs font-black text-zinc-400 outline-none mono bevel-inset no-active" /></div>
                   <div className="space-y-2"><label className="text-[9px] font-black text-zinc-500 uppercase tracking-widest ml-1">AES Key</label><input type="password" value={encryptionKey} onChange={(e) => setEncryptionKey(e.target.value)} className="w-full bg-black border border-white/10 rounded-xl px-4 py-4 text-xs font-black text-zinc-400 outline-none mono bevel-inset no-active" /></div>
                </div>
                <button onClick={() => {
                  localStorage.setItem('easycom_mobile_host_ip', hostIp)
                  localStorage.setItem('easycom_mobile_host_port', hostPort)
                  localStorage.setItem('easycom_mobile_session_pw', sessionPassword)
                  localStorage.setItem('easycom_mobile_enc_key', encryptionKey)
                  setIsNetSetupOpen(false)
                }} className="w-full py-5 bg-blue-600 text-white font-black rounded-2xl shadow-xl mt-8 uppercase text-xs tracking-[0.4em] bevel">Save & Close</button>
             </div>
           )}
        </div>
      </div>
    );
  }

  const bothVideosActive = showVideo1 && showVideo2;

  return (
    <div className={`flex items-center justify-center h-full bg-[#050505] select-none ${isActualMobile ? 'p-0' : 'p-4'}`}>
      <div className={`${isActualMobile ? 'w-full h-full rounded-none border-0' : 'w-[300px] aspect-[9/19] rounded-[2.5rem] border-[8px] border-zinc-800'} bg-zinc-950 shadow-2xl relative overflow-hidden flex flex-col`}>
         
         {isVideoExpanded && (
           <div className="absolute inset-0 z-[200] bg-black flex flex-col animate-in fade-in zoom-in duration-300">
             <div className="flex-1 relative flex items-center justify-center">
               <div className="w-full aspect-video bg-zinc-900 relative">
                  <video ref={expandedVideoRef} autoPlay playsInline className="w-full h-full object-contain" />
               </div>
               <button onClick={() => setIsVideoExpanded(false)} className="absolute top-12 right-6 p-4 bg-zinc-900 border border-white/10 text-white rounded-full shadow-2xl"><X size={24} /></button>
             </div>
           </div>
         )}

         <div className="pt-10 pb-3 px-5 flex justify-between items-center bg-zinc-900/80 border-b border-white/5 safe-top shrink-0 shadow-xl">
           <div className="flex flex-col">
              <span className={`text-[9px] font-black uppercase tracking-widest flex items-center gap-1 ${hijackedClient ? 'text-red-500' : 'text-green-500'}`}><Activity size={8} /> LIVE</span>
              <span className="text-white font-black text-xs uppercase italic tracking-tighter truncate w-24">{activeClient ? activeClient.name : 'OFFLINE'}</span>
           </div>
           <div className="flex gap-1.5">
             <button onClick={handleTBVToggle} className={`px-2.5 py-1.5 rounded-lg bevel no-active shadow-lg transition-all text-[8px] font-black uppercase tracking-widest ${isTBVActive ? `bg-${themeColor}-600 text-white` : 'bg-zinc-800 text-zinc-500'}`}>TBV</button>
             <button onClick={() => setShowVideo1(!showVideo1)} className={`px-2.5 py-1.5 rounded-lg bevel no-active shadow-lg transition-all text-[8px] font-black uppercase tracking-widest ${showVideo1 ? 'bg-red-600 text-white' : 'bg-zinc-800 text-zinc-500'}`}>F1</button>
             <button onClick={() => setShowVideo2(!showVideo2)} className={`px-2.5 py-1.5 rounded-lg bevel no-active shadow-lg transition-all text-[8px] font-black uppercase tracking-widest ${showVideo2 ? 'bg-blue-600 text-white' : 'bg-zinc-800 text-zinc-500'}`}>F2</button>
             <button onClick={() => setIsSettingsOpen(true)} className="p-2 ml-1 bg-zinc-800 rounded-lg text-zinc-400 hover:text-white transition-all bevel no-active"><Settings size={14} /></button>
           </div>
         </div>
         
         <div className="flex-1 p-4 pb-4 flex flex-col bg-gradient-to-b from-zinc-900/40 to-black overflow-hidden relative">
            {/* WATERMARK BACKGROUND */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none overflow-hidden opacity-[0.04] select-none z-0">
               <div className="flex flex-col items-center rotate-[-25deg]">
                  <Radio size={320} strokeWidth={0.5} className="text-white" />
                  <span className="text-[72px] font-black italic tracking-tighter uppercase mt-[-60px] text-white">EasyCom</span>
                  <span className="text-[12px] font-black tracking-[0.8em] uppercase mt-4 text-white">Broadcast Link Verified</span>
               </div>
            </div>

            {/* METERS AT TOP */}
            <div className="grid grid-cols-4 gap-1.5 h-14 mb-4 shrink-0 relative z-10">
                {[0, 1, 2, 3].map(pairIdx => (
                    <div key={pairIdx} className="grid grid-cols-2 gap-1 rounded-lg p-1 bg-black/40 border border-white/5 shadow-xl">
                      {[0, 1].map(offset => {
                        const idx = pairIdx * 2 + offset;
                        const hostLevel = activeClient?.levels[idx] || 0;
                        const recvLevel = recvLevels[idx + 1] ?? 0;
                        const level = Math.max(hostLevel, recvLevel) || -60;
                        return (
                          <div key={idx} className="relative flex flex-col items-center gap-0.5 bg-black/60 p-0.5 rounded-md border border-white/5 h-full bevel-inset no-active overflow-hidden">
                            <div className="w-full flex-1 bg-zinc-950 rounded-[1px] relative overflow-hidden">
                              <div className={`absolute bottom-0 w-full transition-all duration-75 ${level > -6 ? 'bg-red-500' : 'bg-green-500'}`} style={{ height: `${Math.max(2, (level + 60) * 1.66)}%` }} />
                            </div>
                            <span className="text-[4px] font-black text-zinc-500 uppercase truncate w-full text-center leading-none mt-0.5">{talkNames[idx]}</span>
                          </div>
                        );
                      })}
                    </div>
                ))}
            </div>

            <div className="flex-1 min-h-0 overflow-hidden flex flex-col justify-start relative z-10">
              {/* ENFORCED 16:9 VIDEO FEEDS - Resizing to fit space if both active */}
              <div className={`flex flex-col gap-2 transition-all duration-500 flex-1 min-h-0 ${bothVideosActive ? 'max-h-full' : ''}`}>
                {showVideo1 && (
                  <div className={`relative w-full overflow-hidden border transition-all ${bothVideosActive ? 'flex-1 min-h-0' : 'aspect-video'} ${isActuallyTalking(0) ? `border-${themeColor}-500 shadow-lg` : 'border-white/10'} rounded-xl bg-black shadow-2xl`}>
                    <video ref={videoRef1} autoPlay playsInline className="w-full h-full object-cover" />
                    <div className="absolute top-2 left-3 flex items-center gap-1"><div className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" /><span className="text-[7px] font-black text-white uppercase drop-shadow-md">PGM 01</span></div>
                    <button onClick={() => { setExpandedSource(1); setIsVideoExpanded(true); }} className="absolute bottom-2 right-2 p-1.5 bg-black/40 rounded-full text-white/40"><Maximize2 size={12} /></button>
                  </div>
                )}
                {showVideo2 && (
                  <div className={`relative w-full overflow-hidden border transition-all ${bothVideosActive ? 'flex-1 min-h-0' : 'aspect-video'} ${isActuallyTalking(1) ? `border-blue-500 shadow-lg` : 'border-white/10'} rounded-xl bg-black shadow-2xl`}>
                    <video ref={videoRef2} autoPlay playsInline className="w-full h-full object-cover" />
                    <div className="absolute top-2 left-3 flex items-center gap-1"><div className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" /><span className="text-[7px] font-black text-white uppercase drop-shadow-md">PGM 02</span></div>
                    <button onClick={() => { setExpandedSource(2); setIsVideoExpanded(true); }} className="absolute bottom-2 right-2 p-1.5 bg-black/40 rounded-full text-white/40"><Maximize2 size={12} /></button>
                  </div>
                )}
              </div>
            </div>
            
            <div className="mt-auto flex flex-col gap-3 pb-2 safe-bottom shrink-0 pt-2 relative z-10">
               {/* TONE MODE TOGGLE */}
               {!hijackedClient && (
                 <div className="flex justify-center gap-2">
                   <button onClick={handleToneToggle}
                     className={`px-8 py-1.5 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all bevel no-active ${toneActive ? 'bg-purple-600 text-white shadow-lg shadow-purple-900/50' : 'bg-zinc-800/60 border border-white/5 text-zinc-500'}`}>
                     {toneActive ? 'TONE AKTIV' : 'TONE MODE'}
                   </button>
                   <button onClick={() => {
                     const next = !stereoTestActive
                     setStereoTestActive(next)
                     next ? startStereoTestTone(17, 18) : stopStereoTestTone()
                   }}
                     className={`px-4 py-1.5 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all bevel no-active ${stereoTestActive ? 'bg-cyan-600 text-white shadow-lg shadow-cyan-900/50' : 'bg-zinc-800/60 border border-white/5 text-zinc-500'}`}>
                     {stereoTestActive ? 'L/R AKTIV' : 'STEREO TEST'}
                   </button>
                 </div>
               )}
               {backtalkEnabled && !isTBVActive && (
                 <div className="flex justify-center -mb-1">
                   <div className="flex bg-black/80 p-1 rounded-xl border border-white/5 shadow-2xl bevel-inset no-active gap-1">
                      <button onClick={() => setBacktalkAudioMode('1')} className={`px-5 py-1.5 rounded-lg text-[9px] font-black transition-all ${backtalkAudioMode === '1' ? `bg-${themeColor}-600 text-white shadow-lg` : 'text-zinc-600'}`}>CH 1 ONLY</button>
                      <button onClick={() => setBacktalkAudioMode('1+2')} className={`px-5 py-1.5 rounded-lg text-[9px] font-black transition-all ${backtalkAudioMode === '1+2' ? `bg-${themeColor}-600 text-white shadow-lg` : 'text-zinc-600'}`}>CH 1 + 2</button>
                   </div>
                 </div>
               )}

               {isTBVActive ? (
                 <div className="grid grid-cols-2 grid-rows-2 gap-3 h-[220px]">
                    {[2, 3, 0, 1].map(idx => (
                      <div key={idx} className="relative">
                        <button 
                          onMouseDown={() => !latches[idx] && handleTalkToggle(idx, true)} 
                          onMouseUp={() => !latches[idx] && handleTalkToggle(idx, false)}
                          onClick={() => latches[idx] && handleLatchToggle(idx)}
                          className={`w-full h-full rounded-3xl flex flex-col items-center justify-center transition-all bevel ${isActuallyTalking(idx) ? `bg-${themeColor}-600 text-white shadow-lg` : 'bg-zinc-800 text-zinc-500'}`}
                        >
                          <Mic size={24} className={isActuallyTalking(idx) ? 'text-white' : 'text-zinc-700'} />
                          <span className={`mt-1 font-black uppercase tracking-widest text-[9px] italic ${isActuallyTalking(idx) ? 'text-white' : 'text-zinc-600'}`}>{talkNames[idx]}</span>
                        </button>
                        <button onClick={(e) => { e.stopPropagation(); handleLatchToggle(idx); }} className={`absolute top-2 right-2 p-1.5 rounded-xl border transition-all bevel no-active ${latches[idx] ? `bg-white text-${themeColor}-600 border-white shadow-md` : 'bg-black/40 border-white/10 text-zinc-700 hover:text-white'}`}><Anchor size={10} /></button>
                      </div>
                    ))}
                 </div>
               ) : (
                 <>
                   <div className="relative h-[105px] group shrink-0">
                     <button onMouseDown={() => !latches[1] && handleBacktalkToggle(true)} onMouseUp={() => !latches[1] && handleBacktalkToggle(false)} onClick={() => latches[1] && handleLatchToggle(1)} className={`w-full h-full rounded-[2.5rem] flex flex-col items-center justify-center transition-all shadow-2xl bevel ${isActuallyTalking(1) ? (backtalkEnabled ? 'bg-orange-600 text-white shadow-[0_0_30px_rgba(234,88,12,0.6)]' : `bg-${themeColor}-600 text-white`) : 'bg-zinc-800 text-zinc-500'}`}>
                       {backtalkEnabled ? <Network size={28} className={isActuallyTalking(1) ? 'text-white animate-pulse' : 'text-zinc-700'} /> : <Mic size={28} className={isActuallyTalking(1) ? 'text-white' : 'text-zinc-700'} />}
                       <span className={`mt-1 font-black uppercase tracking-widest text-[10px] italic ${isActuallyTalking(1) ? 'text-white' : 'text-zinc-600'}`}>{backtalkEnabled ? 'TALKBACK' : talkNames[1]}</span>
                     </button>
                     <button onClick={(e) => { e.stopPropagation(); handleLatchToggle(1); }} className={`absolute top-3 right-4 p-2.5 rounded-2xl border transition-all bevel no-active ${latches[1] ? `bg-white text-${themeColor}-600 border-white shadow-xl` : 'bg-black/40 border-white/10 text-zinc-700 hover:text-white'}`}><Anchor size={14} /></button>
                   </div>
                   <div className="relative h-[105px] group shrink-0">
                     <button onMouseDown={() => !latches[0] && handleTalkToggle(0, true)} onMouseUp={() => !latches[0] && handleTalkToggle(0, false)} onClick={() => latches[0] && handleLatchToggle(0)} className={`w-full h-full rounded-[2.5rem] flex flex-col items-center justify-center transition-all shadow-2xl bevel ${isActuallyTalking(0) ? `bg-${themeColor}-600 text-white shadow-[0_0_30px_rgba(234,88,12,0.4)]` : 'bg-zinc-800 text-zinc-500'}`}>
                       <Mic size={28} className={isActuallyTalking(0) ? 'text-white' : 'text-zinc-700'} />
                       <span className={`mt-1 font-black uppercase tracking-widest text-[10px] italic ${isActuallyTalking(0) ? 'text-white' : 'text-zinc-600'}`}>{talkNames[0]}</span>
                     </button>
                     <button onClick={(e) => { e.stopPropagation(); handleLatchToggle(0); }} className={`absolute top-3 right-4 p-2.5 rounded-2xl border transition-all bevel no-active ${latches[0] ? `bg-white text-${themeColor}-600 border-white shadow-xl` : 'bg-black/40 border-white/10 text-zinc-700 hover:text-white'}`}><Anchor size={14} /></button>
                   </div>
                 </>
               )}
            </div>
         </div>

         {isSettingsOpen && (
           <div className="absolute inset-0 z-[120] bg-black/98 backdrop-blur-2xl flex flex-col animate-in fade-in duration-300">
             <div className="pt-10 pb-4 px-8 border-b border-white/5 flex justify-between items-center bg-zinc-950 shrink-0"><h3 className="text-white font-black uppercase italic tracking-tighter">Terminal Preferences</h3><button onClick={() => setIsSettingsOpen(false)} className="p-2 text-zinc-500 hover:text-white transition-all"><X size={24} /></button></div>
             <div className="flex-1 overflow-auto p-6 space-y-8 custom-scrollbar pb-24">
                
                <div className="bg-zinc-900/50 p-6 rounded-3xl border border-white/5 space-y-6">
                   <div className="flex items-center justify-between">
                      <div className="flex flex-col">
                        <span className="text-[10px] font-black text-white uppercase tracking-widest">Backtalk Mode</span>
                        <span className="text-[8px] font-bold text-zinc-500 uppercase mt-0.5 italic">External GPIO Trigger</span>
                      </div>
                      <button onClick={() => setBacktalkEnabled(!backtalkEnabled)} className={`w-14 h-8 rounded-full transition-all flex items-center px-1 border ${backtalkEnabled ? `bg-orange-600 border-white` : 'bg-black border-white/10'}`}>
                        <div className={`w-6 h-6 rounded-full bg-white transition-transform ${backtalkEnabled ? 'translate-x-6' : 'translate-x-0'}`} />
                      </button>
                   </div>
                   {backtalkEnabled && (
                     <div className="pt-4 border-t border-white/5 space-y-3">
                        <label className="text-[9px] font-black text-zinc-500 uppercase tracking-widest ml-1">Backtalk Audio Routing</label>
                        <div className="flex bg-black p-1 rounded-xl border border-white/5 bevel-inset no-active gap-1">
                           <button onClick={() => setBacktalkAudioMode('1')} className={`flex-1 py-2 rounded-lg text-[8px] font-black transition-all ${backtalkAudioMode === '1' ? `bg-orange-600 text-white shadow-lg` : 'text-zinc-600'}`}>CHANNEL 1 ONLY</button>
                           <button onClick={() => setBacktalkAudioMode('1+2')} className={`flex-1 py-2 rounded-lg text-[8px] font-black transition-all ${backtalkAudioMode === '1+2' ? `bg-orange-600 text-white shadow-lg` : 'text-zinc-600'}`}>CHANNELS 1 + 2</button>
                        </div>
                     </div>
                   )}
                </div>

                <div className="bg-zinc-900/50 p-6 rounded-3xl border border-white/5 space-y-6">
                   <h4 className="text-[10px] font-black text-zinc-500 uppercase tracking-widest px-1">Monitoring Volumes</h4>
                   <div className="space-y-6 pt-4">
                      <div className="space-y-2">
                        <div className="flex justify-between items-center"><label className="text-[9px] font-black text-white uppercase tracking-widest">Video Feed 1 (PGM A)</label><span className={`text-[10px] font-mono text-${themeColor}-500`}>{videoVolume1}%</span></div>
                        <div className="flex items-center gap-4">
                          <Video size={14} className="text-zinc-600" />
                          <input type="range" min="0" max="100" value={videoVolume1} onChange={(e) => setVideoVolume1(parseInt(e.target.value))} className={`flex-1 h-1 bg-black rounded-full appearance-none ${themeColor}-thumb`} />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <div className="flex justify-between items-center"><label className="text-[9px] font-black text-white uppercase tracking-widest">Video Feed 2 (PGM B)</label><span className={`text-[10px] font-mono text-${themeColor}-500`}>{videoVolume2}%</span></div>
                        <div className="flex items-center gap-4">
                          <Video size={14} className="text-zinc-600" />
                          <input type="range" min="0" max="100" value={videoVolume2} onChange={(e) => setVideoVolume2(parseInt(e.target.value))} className={`flex-1 h-1 bg-black rounded-full appearance-none ${themeColor}-thumb`} />
                        </div>
                      </div>
                   </div>
                </div>

                <div className="bg-zinc-900/50 p-6 rounded-3xl border border-white/5 space-y-5">
                   <h4 className="text-[10px] font-black text-zinc-500 uppercase tracking-widest px-1">Channel Settings</h4>
                   {[0,1,2,3,4,5,6,7].map(idx => (
                     <div key={idx} className="space-y-3 pt-4 first:pt-0 border-t first:border-0 border-white/5">
                       <div className="flex items-center gap-2">
                         <span className="text-[9px] font-black text-zinc-400 uppercase italic w-10 shrink-0">CH {idx + 1}</span>
                         <input
                           value={talkNames[idx]}
                           onChange={(e) => handleNameSaveLocal(idx, e.target.value)}
                           className="flex-1 bg-black border border-white/10 rounded-lg p-2 text-[9px] font-black text-white outline-none uppercase bevel-inset"
                         />
                       </div>
                       <div className="space-y-1.5">
                         <div className="flex justify-between items-center">
                           <label className="text-[8px] font-black text-zinc-500 uppercase">Gain</label>
                           <span className={`text-[10px] font-mono text-${themeColor}-500`}>{gains[idx]}%</span>
                         </div>
                         <input type="range" min="0" max="100" value={gains[idx]} onChange={(e) => updateGain(idx, parseInt(e.target.value))} className={`w-full h-1 bg-black rounded-full appearance-none ${themeColor}-thumb`} />
                       </div>
                       <div className="space-y-1.5">
                         <label className="text-[8px] font-black text-zinc-500 uppercase">Pan — {pans[idx] < -15 ? `L${Math.abs(pans[idx])}` : pans[idx] > 15 ? `R${pans[idx]}` : 'C'}</label>
                         <div className="flex items-center gap-1.5">
                           <button onClick={() => updatePan(idx, -50)} className={`px-2.5 py-1.5 rounded-lg text-[9px] font-black shrink-0 transition-all bevel ${pans[idx] <= -40 ? `bg-${themeColor}-600 text-white` : 'bg-zinc-800 text-zinc-500'}`}>L</button>
                           <input type="range" min="-50" max="50" value={pans[idx]} onChange={(e) => updatePan(idx, parseInt(e.target.value))} className={`flex-1 h-1 bg-black rounded-full appearance-none ${themeColor}-thumb`} />
                           <button onClick={() => updatePan(idx, 0)} className={`px-2.5 py-1.5 rounded-lg text-[9px] font-black shrink-0 transition-all bevel ${Math.abs(pans[idx]) <= 10 ? 'bg-zinc-700 text-white' : 'bg-zinc-800 text-zinc-500'}`}>C</button>
                           <button onClick={() => updatePan(idx, 50)} className={`px-2.5 py-1.5 rounded-lg text-[9px] font-black shrink-0 transition-all bevel ${pans[idx] >= 40 ? `bg-${themeColor}-600 text-white` : 'bg-zinc-800 text-zinc-500'}`}>R</button>
                         </div>
                       </div>
                     </div>
                   ))}
                </div>

                <button onClick={handleDisconnect} className="w-full flex items-center justify-between p-5 bg-red-950/20 border border-red-500/30 rounded-2xl text-red-500 bevel"><span className="text-[10px] font-black uppercase tracking-widest">Terminate Link</span><LogOut size={20} /></button>
             </div>
             <div className="p-8 border-t border-white/5 bg-zinc-950 shrink-0 safe-bottom"><button onClick={() => setIsSettingsOpen(false)} className={`w-full py-5 bg-${themeColor}-600 text-white font-black rounded-2xl uppercase text-xs tracking-[0.4em] bevel shadow-xl`}>Commit Changes</button></div>
           </div>
         )}
      </div>
    </div>
  );
};

export default MobileClientView;