import React, { useState, useMemo } from 'react';
import { Client, MappedClient, RemoteHost } from '../types';
import { Globe, Users, GripVertical, Link2, AlertTriangle, ChevronDown, Zap, Radio, Search } from 'lucide-react';

interface ClientLinkingProps {
  clients: Client[];
  updateClient: (id: string, updates: Partial<Client>) => void;
  remoteHosts: RemoteHost[];
  theme: 'orange' | 'blue';
}

const ClientLinking: React.FC<ClientLinkingProps> = ({ clients, updateClient, remoteHosts, theme }) => {
  const [selectedHostId, setSelectedHostId] = useState<string>(remoteHosts[0]?.id || 'all');
  const [searchTerm, setSearchTerm] = useState('');

  const themeColor = theme === 'orange' ? 'orange' : 'blue';

  const remoteSources = useMemo(() => {
    const list: MappedClient[] = [];
    const hostsToProcess = selectedHostId === 'all' ? remoteHosts : remoteHosts.filter(h => h.id === selectedHostId);
    
    hostsToProcess.forEach(host => {
      for(let i = 1; i <= 16; i++) {
        list.push({
          id: `remote-src-${host.id}-${i}`,
          name: `${host.name} : CL ${i}`,
          color: i % 2 === 0 ? '#3b82f6' : '#ef4444'
        } as any);
      }
    });
    return list;
  }, [remoteHosts, selectedHostId]);

  const onDropOnLocalSlot = (e: React.DragEvent, targetClientId: string) => {
    e.preventDefault();
    const sourceId = e.dataTransfer.getData('libraryClientId');
    const isRemote = e.dataTransfer.getData('isRemote') === 'true';

    if (isRemote && sourceId) {
      const src = remoteSources.find(s => s.id === sourceId);
      if (src) {
        updateClient(targetClientId, {
          name: src.name,
          linkedSourceId: src.id,
          status: 'online',
          color: src.color
        });
      }
    }
  };

  const filteredLibrary = remoteSources.filter(c => 
    c.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="flex h-full overflow-hidden bg-black/20">
      {/* Sidebar Library - Only Remote Hosts */}
      <div className="w-80 border-r border-white/5 bg-zinc-950/40 p-0 flex flex-col shrink-0">
        <div className="flex bg-black/60 p-1 border-b border-white/5">
          <div className="flex-1 py-3 text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-2 text-white bg-zinc-800 shadow-xl bevel no-active">
            <Globe size={14} /> REMOTE HOSTS
          </div>
        </div>

        <div className="p-3 border-b border-white/5 bg-black/20 space-y-3">
          <div className="space-y-1">
            <label className="text-[8px] font-black text-zinc-500 uppercase tracking-widest block">Signal Source</label>
            <div className="relative">
              <select 
                value={selectedHostId}
                onChange={(e) => setSelectedHostId(e.target.value)}
                className={`w-full bg-zinc-900 border border-white/10 rounded-lg px-3 py-2 text-[10px] text-white font-black uppercase appearance-none outline-none focus:border-${themeColor}-500`}
              >
                <option value="all">All Connected Hosts</option>
                {remoteHosts.map(h => (
                  <option key={h.id} value={h.id}>{h.name}</option>
                ))}
              </select>
              <ChevronDown size={14} className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" />
            </div>
          </div>
          <div className="relative">
             <Search className="absolute left-2 top-2 text-zinc-600" size={12} />
             <input 
               value={searchTerm}
               onChange={(e) => setSearchTerm(e.target.value)}
               placeholder="Search signals..."
               className={`w-full bg-black/40 border border-white/5 rounded-lg px-8 py-2 text-[10px] text-zinc-400 focus:border-${themeColor}-500 outline-none uppercase font-black`}
             />
          </div>
        </div>

        <div className="p-4 flex-1 overflow-auto space-y-2 custom-scrollbar">
          {filteredLibrary.map(c => (
            <div 
              key={c.id} 
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData('libraryClientId', c.id);
                e.dataTransfer.setData('isRemote', 'true');
              }}
              className="bg-zinc-900/50 border border-white/5 p-3 rounded-xl flex items-center gap-3 cursor-grab active:cursor-grabbing hover:bg-zinc-800 hover:border-white/10 transition-all bevel no-active group"
            >
              <div className="w-3.5 h-3.5 rounded-full shrink-0 shadow-[0_0_5px_rgba(0,0,0,0.5)]" style={{ backgroundColor: c.color }} />
              <div className="flex flex-col min-w-0">
                <span className="text-[10px] font-black text-zinc-300 uppercase truncate tracking-tight leading-none">{c.name}</span>
                <span className="text-[7px] text-zinc-600 font-bold uppercase mt-1">Network Ingest</span>
              </div>
              <GripVertical size={12} className="ml-auto text-zinc-700 group-hover:text-zinc-500" />
            </div>
          ))}
          {filteredLibrary.length === 0 && (
             <div className="text-center py-12">
               <span className="text-[10px] font-black text-zinc-700 uppercase tracking-widest">No Signals Found</span>
             </div>
          )}
        </div>
      </div>

      {/* Main Signal Bridge Matrix */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="p-8 border-b border-white/5 bg-zinc-900/20 flex items-center justify-between">
           <div>
             <h3 className="text-xl font-black text-white italic tracking-tighter uppercase">Signal Bridge Matrix</h3>
             <p className="text-[10px] text-zinc-500 font-black uppercase tracking-[0.2em] mt-1">Ingest Remote Signal Paths into Host Clients</p>
           </div>
           <div className="flex items-center gap-4">
              <div className="flex items-center gap-2 px-4 py-2 bg-black/40 border border-white/5 rounded-full">
                 <Link2 size={14} className={`text-${themeColor}-500`} />
                 <span className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Active Paths: {clients.filter(c => c.linkedSourceId).length}</span>
              </div>
           </div>
        </div>

        <div className="flex-1 p-8 overflow-auto custom-scrollbar">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-6">
            {clients.map((c) => {
              const isFree = c.status === 'offline';
              const isBridged = !!c.linkedSourceId;
              
              return (
                <div 
                  key={c.id}
                  onDragOver={(e) => isFree && e.preventDefault()}
                  onDrop={(e) => isFree && onDropOnLocalSlot(e, c.id)}
                  className={`relative min-h-[140px] rounded-[2rem] border transition-all duration-300 bevel no-active flex flex-col p-6 shadow-2xl ${isBridged ? `bg-${themeColor}-600/10 border-${themeColor}-500/50 shadow-${themeColor}-950/20` : isFree ? `bg-zinc-900 border-white/5 hover:border-${themeColor}-500/20 group cursor-pointer` : 'bg-black/20 border-white/5 opacity-40 grayscale pointer-events-none'}`}
                >
                  <div className="flex justify-between items-center mb-auto">
                     <span className="text-[9px] font-black text-zinc-600 uppercase tracking-[0.3em]">CL {c.id.split('-')[1]}</span>
                     {isBridged ? (
                       <div className={`bg-${themeColor}-600 p-1.5 rounded-lg shadow-xl shadow-${themeColor}-900/40`}>
                         <Link2 size={12} className="text-white" />
                       </div>
                     ) : isFree ? (
                       <div className={`p-1.5 text-zinc-700 group-hover:text-${themeColor}-500 group-hover:scale-110 transition-all`}>
                         <Zap size={14} />
                       </div>
                     ) : (
                       <div className="p-1.5 text-zinc-800"><Radio size={14} /></div>
                     )}
                  </div>

                  <div className="mt-auto flex flex-col gap-2">
                     <div className="flex items-center gap-2">
                        {isBridged && <div className={`w-2.5 h-2.5 rounded-full bg-${themeColor}-500 animate-pulse shadow-[0_0_8px_rgba(34,197,94,0.6)]`} />}
                        <span className={`text-[12px] font-black uppercase truncate tracking-tight leading-none ${isBridged ? 'text-white' : 'text-zinc-500'}`}>{c.name}</span>
                     </div>
                     
                     <div className="flex flex-col">
                        <span className={`text-[8px] font-bold uppercase tracking-widest ${isBridged ? `text-${themeColor}-500` : isFree ? 'text-zinc-700' : 'text-zinc-800'}`}>
                          {isBridged ? 'Path: Remote Link' : isFree ? 'Ready for ingest' : 'Occupied (Active)'}
                        </span>
                        {isBridged && (
                          <button 
                            onClick={(e) => { e.stopPropagation(); updateClient(c.id, { linkedSourceId: undefined, status: 'offline' }); }}
                            className="mt-3 py-1.5 bg-red-950/40 border border-red-500/30 rounded-lg text-[8px] font-black text-red-500 uppercase tracking-widest hover:bg-red-600 hover:text-white transition-all bevel"
                          >
                             Disconnect Bridge
                          </button>
                        )}
                     </div>
                  </div>

                  {isFree && (
                    <div className={`absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-${themeColor}-600/5 rounded-[2rem] pointer-events-none`}>
                       <span className={`text-[9px] font-black text-${themeColor}-500 bg-zinc-950 px-3 py-2 rounded-full border border-${themeColor}-500/20 shadow-2xl`}>Drop Source to Bridge</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ClientLinking;