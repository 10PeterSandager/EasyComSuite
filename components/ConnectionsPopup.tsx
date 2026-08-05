import { useEffect, useState } from "react"
import { socket, setAudioOutputDevice } from "../client/webrtc/intercom"
import { Client } from "../types"
import { Unlink, RefreshCw, ChevronRight, ChevronLeft, Check, X, Wifi, WifiOff, Server, Users, ArrowUpRight, ArrowRight, ArrowLeft, GripHorizontal } from "lucide-react"
import { useDraggable } from "../hooks/useDraggable"

type Connection = { from: string; to: string; channel: number; toChannel?: number }

// Module-level: tracks which connections were created as "talk" type.
// Stored in localStorage so it survives remounts.
const TALK_KEYS_LS = "easycom:talk-conn-keys"
const talkConnKeys = new Set<string>(
  (() => { try { return JSON.parse(localStorage.getItem(TALK_KEYS_LS) || "[]") } catch { return [] } })()
)
const ck = (from: string, to: string, ch: number) => `${from}|${to}|${ch}`
const saveTalkKeys = () => {
  try { localStorage.setItem(TALK_KEYS_LS, JSON.stringify([...talkConnKeys])) } catch {}
}
type ChannelInfo = { channel: number; name: string; type: "input" | "output" }
type Step =
  | "overview"
  | "pick-destinations"
  | "pick-talk"
  | "pick-receive"
  | "sc-pick-src"
  | "sc-pick-recv-ch"
  | "output-pick-my-ch"
  | "output-pick-soundcard"
  | "output-pick-device"

type StereoPair = { id: string; name: string; chL: number; chR: number }

type Props = {
  open: boolean
  onClose: () => void
  sourceClient: Client
  clients: Client[]
  onUpdateClient: (id: string, updates: Partial<Client>) => void
  clientTalkNames?: Record<string, string>
  stereoPairs?: StereoPair[]
}

const CH_COLORS = [
  "#ef4444", "#3b82f6", "#22c55e", "#a855f7",
  "#f97316", "#06b6d4", "#eab308", "#ec4899",
]

const TALK_CH = 4
const RECV_CH = 16
const BASE_ID = "producer-65"

const STEREO_COLOR = "#a855f7"

export default function ConnectionsPopup({
  open, onClose, sourceClient, clients, onUpdateClient, clientTalkNames = {}, stereoPairs = [],
}: Props) {
  const { pos, onMouseDown } = useDraggable()
  const [connections, setConnections] = useState<Connection[]>([])
  const [socketOk, setSocketOk] = useState(socket.connected)
  const [bridgeChannels, setBridgeChannels] = useState<ChannelInfo[]>([])

  const [step, setStep] = useState<Step>("overview")
  // client-connections flow
  const [selectedDestIds, setSelectedDestIds] = useState<string[]>([])
  const [talkSrcCh, setTalkSrcCh] = useState<number | null>(null)
  const [talkDestCh, setTalkDestCh] = useState<number | null>(null)
  const [recvMyCh, setRecvMyCh] = useState<number | null>(null)
  const [recvDestCh, setRecvDestCh] = useState<number | null>(null)
  // soundcard input flow
  const [scSrcId, setScSrcId] = useState<string | null>(null)
  const [scSrcName, setScSrcName] = useState("")
  const [scRecvCh, setScRecvCh] = useState<number | null>(null)
  const [scIsStereo, setScIsStereo] = useState(false)
  // output flow
  const [selectedMyOutputChs, setSelectedMyOutputChs] = useState<number[]>([])
  const [selectedSoundcardCh, setSelectedSoundcardCh] = useState<number | null>(null)
  const [audioOutputDevices, setAudioOutputDevices] = useState<MediaDeviceInfo[]>([])
  const [selectedAudioOutput, setSelectedAudioOutput] = useState<string>("")
  // Server-side PortAudio output device config
  const [serverOutputDevices, setServerOutputDevices] = useState<any[]>([])
  const [selectedServerDevice, setSelectedServerDevice] = useState<number>(-1)
  const [selectedDeviceChannels, setSelectedDeviceChannels] = useState<number>(2)

  const isMobile = sourceClient.type === "mobile"
  const isBase = sourceClient.id === BASE_ID

  const clientTalkChCount = (clientId: string) =>
    clientId === BASE_ID ? 1 : (clients.find(c => c.id === clientId)?.type === "mobile" ? TALK_CH : RECV_CH)
  const clientRecvChCount = (clientId: string) => {
    if (clientId === BASE_ID) return 1
    const type = clients.find(c => c.id === clientId)?.type ?? (clientId === sourceClient.id ? sourceClient.type : "desktop")
    return type === "mobile" ? 8 : RECV_CH
  }

  useEffect(() => {
    const onC = () => setSocketOk(true)
    const onD = () => setSocketOk(false)
    socket.on("connect", onC)
    socket.on("disconnect", onD)
    setSocketOk(socket.connected)
    return () => { socket.off("connect", onC); socket.off("disconnect", onD) }
  }, [])

  useEffect(() => {
    if (!open || !isBase) return
    // Request mic permission first so enumerateDevices returns labeled output devices
    navigator.mediaDevices.getUserMedia({ audio: true })
      .then(s => s.getTracks().forEach(t => t.stop()))
      .catch(() => {})
      .finally(() => {
        navigator.mediaDevices.enumerateDevices().then(devices => {
          const outputs = devices.filter(d => d.kind === "audiooutput")
          setAudioOutputDevices(outputs)
          if (outputs.length > 0 && !selectedAudioOutput) setSelectedAudioOutput(outputs[0].deviceId)
        }).catch(() => {})
      })
  }, [open])

  useEffect(() => {
    if (!open) { resetFlow(); return }
    const onUpdate = (list: Connection[]) => setConnections(Array.isArray(list) ? list : [])
    socket.on("connections:all", onUpdate)
    socket.emit("connections:request:all")
    const fetchBridge = () => {
      socket.emit("audio:bridge:channelInfo", (info: any) => {
        if (Array.isArray(info) && info.length > 0) setBridgeChannels(info)
        else setBridgeChannels([])
      })
    }
    fetchBridge()
    const t = setTimeout(fetchBridge, 1000)
    return () => { socket.off("connections:all", onUpdate); clearTimeout(t) }
  }, [open])

  // Re-request connections when switching to a different source client
  useEffect(() => {
    if (open) socket.emit("connections:request:all")
  }, [sourceClient.id])

  // Auto-select destination channel when there is only one option (e.g. BASE always has 1 TB/recv channel).
  // This prevents the CONFIRM button from staying grey because the user didn't realise they had to click
  // the single right-column button.
  useEffect(() => {
    if (step !== "pick-talk" || talkDestCh !== null || selectedDestIds.length === 0) return
    const n = Math.min(...selectedDestIds.map(id => clientTalkChCount(id)))
    if (n === 1) setTalkDestCh(1)
  }, [step, talkDestCh]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (step !== "pick-receive" || recvDestCh !== null || selectedDestIds.length === 0) return
    const n = Math.min(...selectedDestIds.map(id => clientRecvChCount(id)))
    if (n === 1) setRecvDestCh(1)
  }, [step, recvDestCh]) // eslint-disable-line react-hooks/exhaustive-deps

  const resetFlow = () => {
    setStep("overview")
    setSelectedDestIds([])
    setTalkSrcCh(null); setTalkDestCh(null)
    setRecvMyCh(null); setRecvDestCh(null)
    setScSrcId(null); setScSrcName(""); setScRecvCh(null); setScIsStereo(false)
    setSelectedMyOutputChs([]); setSelectedSoundcardCh(null)
    setSelectedServerDevice(-1); setSelectedDeviceChannels(2)
  }

  if (!open) return null

  const chColor = (ch: number) => CH_COLORS[(ch - 1) % CH_COLORS.length]

  const outgoing = connections.filter(c => c.from === sourceClient.id)
  const incoming = connections.filter(c => c.to === sourceClient.id)

  const inputBridgeChs = bridgeChannels.filter(c => c.type === "input")
  const outputBridgeChs = bridgeChannels.filter(c => c.type === "output")

  const disconnect = (conn: Connection) => {
    socket.emit("connection:remove", { from: conn.from, to: conn.to, channel: conn.channel })
    talkConnKeys.delete(ck(conn.from, conn.to, conn.channel))
    saveTalkKeys()
  }

  const handleDestClick = (clientId: string, shiftKey: boolean) => {
    if (shiftKey) {
      setSelectedDestIds(prev =>
        prev.includes(clientId) ? prev.filter(id => id !== clientId) : [...prev, clientId]
      )
    } else {
      setSelectedDestIds([clientId])
    }
  }

  const confirmClientConnections = () => {
    if (talkSrcCh === null || talkDestCh === null || recvMyCh === null || recvDestCh === null) return
    for (const destId of selectedDestIds) {
      // Talk: source sends on talkSrcCh → dest receives on talkDestCh
      socket.emit("connection:create", {
        from: sourceClient.id, to: destId,
        channel: talkDestCh, toChannel: talkSrcCh, bidirectional: false,
      })
      talkConnKeys.add(ck(sourceClient.id, destId, talkDestCh))
      // Receive: dest sends on recvDestCh → source receives on recvMyCh
      socket.emit("connection:create", {
        from: destId, to: sourceClient.id,
        channel: recvMyCh, toChannel: recvDestCh, bidirectional: false,
      })
      // receive connection is intentionally NOT added to talkConnKeys
    }
    saveTalkKeys()
    resetFlow()
  }

  const confirmConnectSoundcardInput = () => {
    if (!scSrcId || scRecvCh === null) return
    socket.emit("connection:create", {
      from: scSrcId, to: sourceClient.id, channel: scRecvCh, bidirectional: false,
    })
    resetFlow()
  }

  const confirmConnectStereoInput = (pair: StereoPair) => {
    if (scRecvCh === null) return
    // Single connection from the stereo bridge producer — carries true stereo WebRTC track
    socket.emit("connection:create", {
      from: `bridge-stereo-${pair.chL}-${pair.chR}`,
      to: sourceClient.id,
      channel: scRecvCh,
      bidirectional: false,
    })
    resetFlow()
  }

  const confirmConnectOutput = () => {
    if (selectedMyOutputChs.length === 0 || selectedSoundcardCh === null) return
    socket.emit("output:channel:config", {
      hwChannel: selectedSoundcardCh,
      deviceId: selectedServerDevice,
      deviceChannels: selectedDeviceChannels,
    })
    for (const tbCh of selectedMyOutputChs) {
      socket.emit("connection:create", {
        from: sourceClient.id, to: `bridge-ch${selectedSoundcardCh}`,
        channel: 1, toChannel: tbCh, bidirectional: false,
      })
    }
    resetFlow()
  }

  const fetchServerOutputDevices = () => {
    socket.emit("output:devices:list", (devices: any[]) => {
      setServerOutputDevices(devices ?? [])
      if (devices?.length > 0 && selectedServerDevice === -1) {
        // Try to find a device that matches the bridge channel name
        setSelectedServerDevice(devices[0].id)
        setSelectedDeviceChannels(Math.min(devices[0].maxOutputChannels, 2))
      }
    })
  }

  // ── SHARED BACK BUTTON ──
  const BackBtn = ({ to }: { to: Step | "reset" }) => (
    <button
      onClick={() => to === "reset" ? resetFlow() : setStep(to)}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all"
      style={{ background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.12)", color: "rgba(255,255,255,0.7)" }}>
      <ChevronLeft size={13} /> Back
    </button>
  )

  // ── OVERVIEW ──
  const renderOverview = () => (
    <div className="space-y-4">
      {/* TALK — 4 boxes (mobile) or 8 (desktop). Shows connections tagged as "talk type",
           from either direction, at the channel relevant to this client. */}
      <div className="space-y-2">
        <p className="text-[10px] text-white/60 uppercase tracking-widest font-bold">TALK</p>
        <div className="grid grid-cols-4 gap-1.5">
          {Array.from({ length: clientTalkChCount(sourceClient.id) }, (_, i) => {
            const ch = i + 1
            const talkLabel = clientTalkNames[`talk${ch}`]
            // incoming talk: source → me, channel = ch (I'm on the receiving end)
            const talkIn = incoming.filter(c => c.channel === ch && talkConnKeys.has(ck(c.from, c.to, c.channel)))
            // outgoing talk: me → dest, toChannel = ch (I pressed this TB button)
            const talkOut = outgoing.filter(c => c.toChannel === ch && talkConnKeys.has(ck(c.from, c.to, c.channel)))
            type Entry = { conn: Connection; name: string }
            const active: Entry[] = [
              ...talkIn.map(c => {
                const src = clients.find(x => x.id === c.from)
                const bch = bridgeChannels.find(x => `bridge-ch${x.channel}` === c.from)
                return { conn: c, name: src?.name ?? bch?.name ?? c.from }
              }),
              ...talkOut.map(c => ({ conn: c, name: clients.find(x => x.id === c.to)?.name ?? c.to })),
            ]
            const isActive = active.length > 0
            return (
              <div key={ch}
                className="rounded-lg p-2 space-y-0.5"
                style={isActive
                  ? { background: chColor(ch) + "25", border: `1px solid ${chColor(ch)}60` }
                  : { background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
                <div className="text-xs font-black" style={{ color: isActive ? chColor(ch) : "rgba(255,255,255,0.2)" }}>
                  TB{ch}
                </div>
                {talkLabel && (
                  <div className="text-[7px] font-bold uppercase truncate"
                    style={{ color: isActive ? chColor(ch) : "rgba(255,255,255,0.15)", opacity: 0.85 }}>
                    {talkLabel}
                  </div>
                )}
                {isActive ? (
                  <div className="space-y-0.5 mt-0.5">
                    {active.map(({ conn, name }, idx) => (
                      <div key={idx} className="flex items-center gap-1">
                        <span className="text-[7px] text-white/55 truncate flex-1">{name}</span>
                        <button onClick={() => disconnect(conn)}
                          className="p-0.5 hover:text-red-400 text-white/25 shrink-0">
                          <Unlink size={8} />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-[7px] text-white/15">empty</div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* RECEIVE — shows connections NOT tagged as talk type. */}
      <div className="space-y-2">
        <p className="text-[10px] text-white/60 uppercase tracking-widest font-bold">RECEIVE</p>
        <div className="grid grid-cols-4 gap-1.5">
          {Array.from({ length: clientRecvChCount(sourceClient.id) }, (_, i) => {
            const ch = i + 1
            // incoming non-talk: someone sends to me on channel ch
            const recvIn = incoming.filter(c => c.channel === ch && !talkConnKeys.has(ck(c.from, c.to, c.channel)))
            // outgoing non-talk: I send to someone on toChannel ch
            const recvOut = outgoing.filter(c => c.toChannel === ch && !talkConnKeys.has(ck(c.from, c.to, c.channel)))
            type Entry = { conn: Connection; name: string }
            const active: Entry[] = [
              ...recvIn.map(c => {
                const src = clients.find(x => x.id === c.from)
                const bch = bridgeChannels.find(x => `bridge-ch${x.channel}` === c.from)
                return { conn: c, name: src?.name ?? bch?.name ?? c.from }
              }),
              ...recvOut.map(c => ({ conn: c, name: clients.find(x => x.id === c.to)?.name ?? c.to })),
            ]
            const isActive = active.length > 0
            return (
              <div key={ch}
                className="rounded-lg p-2 space-y-0.5"
                style={isActive
                  ? { background: chColor(ch) + "25", border: `1px solid ${chColor(ch)}60` }
                  : { background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
                <div className="text-xs font-black" style={{ color: isActive ? chColor(ch) : "rgba(255,255,255,0.2)" }}>
                  {ch}
                </div>
                {isActive ? (
                  <div className="space-y-0.5 mt-0.5">
                    {active.map(({ conn, name }, idx) => (
                      <div key={idx} className="flex items-center gap-1">
                        <span className="text-[7px] text-white/55 truncate flex-1">{name}</span>
                        <button onClick={() => disconnect(conn)}
                          className="p-0.5 hover:text-red-400 text-white/25 shrink-0">
                          <Unlink size={8} />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-[7px] text-white/15">empty</div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Audio output selector – BASE only */}
      {isBase && (
        <div className="space-y-2">
          <p className="text-[10px] text-white/60 uppercase tracking-widest font-bold">AUDIO OUTPUT DEVICE</p>
          {audioOutputDevices.length === 0 ? (
            <p className="text-[11px] text-white/40 italic">No output devices found</p>
          ) : (
            <select
              value={selectedAudioOutput}
              onChange={e => {
                setSelectedAudioOutput(e.target.value)
                setAudioOutputDevice(e.target.value)
              }}
              className="w-full bg-zinc-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white">
              {audioOutputDevices.map(d => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || d.deviceId}
                </option>
              ))}
            </select>
          )}
        </div>
      )}

      {/* Add connection buttons */}
      <div className="border-t border-white/5 pt-3 space-y-2">
        <p className="text-[10px] text-white/30 uppercase tracking-widest font-bold">ADD CONNECTION</p>
        <button onClick={() => setStep("pick-destinations")}
          className="w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all"
          style={{ background: "rgba(249,115,22,0.1)", border: "1px solid rgba(249,115,22,0.25)", color: "white" }}>
          <Users size={16} className="text-orange-400 shrink-0" />
          <div className="text-left flex-1">
            <p className="text-sm font-bold">CLIENT CONNECTIONS</p>
            <p className="text-[10px] text-white/40">Connect to one or more clients</p>
          </div>
          <ChevronRight size={14} className="text-white/25" />
        </button>
        <button onClick={() => setStep("sc-pick-src")}
          className="w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all"
          style={{ background: "rgba(59,130,246,0.1)", border: "1px solid rgba(59,130,246,0.25)", color: "white" }}>
          <Server size={16} className="text-blue-400 shrink-0" />
          <div className="text-left flex-1">
            <p className="text-sm font-bold">RECEIVE FROM AUDIO INTERFACE</p>
            <p className="text-[10px] text-white/40">Receive audio from an audio interface input</p>
          </div>
          <ChevronRight size={14} className="text-white/25" />
        </button>
        <button onClick={() => setStep("output-pick-my-ch")}
          className="w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all"
          style={{ background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.25)", color: "white" }}>
          <ArrowUpRight size={16} className="text-green-400 shrink-0" />
          <div className="text-left flex-1">
            <p className="text-sm font-bold">SEND TB TO AUDIO INTERFACE</p>
            <p className="text-[10px] text-white/40">Route a TB button's mic audio to a hardware output channel</p>
          </div>
          <ChevronRight size={14} className="text-white/25" />
        </button>
      </div>
    </div>
  )

  // ── PICK DESTINATIONS ──
  const renderPickDestinations = () => (
    <div className="space-y-3">
      <BackBtn to="reset" />
      <div>
        <p className="text-[10px] text-white/60 uppercase tracking-widest font-bold">CLIENT CONNECTIONS</p>
        <p className="text-[9px] text-white/35 mt-0.5">Hold Shift to select multiple</p>
      </div>
      <div className="space-y-1 max-h-[240px] overflow-y-auto pr-1">
        {clients.filter(c => c.id !== sourceClient.id && !c.hidden).map(c => {
          const selected = selectedDestIds.includes(c.id)
          return (
            <button key={c.id}
              onClick={(e) => handleDestClick(c.id, e.shiftKey)}
              className="w-full flex items-center gap-2 px-3 py-2.5 rounded-lg transition-all"
              style={selected
                ? { background: "rgba(249,115,22,0.15)", border: "1px solid rgba(249,115,22,0.4)", color: "white" }
                : { background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.7)" }}>
              {c.color && <span className="w-2 h-2 rounded-full shrink-0" style={{ background: c.color }} />}
              <span className="text-sm font-bold flex-1 text-left">{c.name}</span>
              {c.type === "mobile" && <span className="text-[8px] text-orange-400/60">mobile</span>}
              {selected && <Check size={12} className="text-orange-400 shrink-0" />}
            </button>
          )
        })}
      </div>
      {selectedDestIds.length > 0 && (
        <button onClick={() => setStep("pick-talk")}
          className="w-full py-2.5 rounded-xl text-sm font-bold flex items-center justify-center gap-2"
          style={{ background: "rgba(249,115,22,0.8)", color: "white" }}>
          {selectedDestIds.length > 1 ? `${selectedDestIds.length} selected` : "Next"} – choose TB channel
          <ChevronRight size={14} />
        </button>
      )}
    </div>
  )

  // ── PICK TALK ──
  const renderPickTalk = () => {
    const destLabel = selectedDestIds
      .map(id => clients.find(c => c.id === id)?.name ?? id)
      .join(", ")
    const srcTalkCh = clientTalkChCount(sourceClient.id)
    const dstTalkCh = Math.min(...selectedDestIds.map(id => clientTalkChCount(id)))
    return (
      <div className="space-y-3">
        <BackBtn to="pick-destinations" />
        <p className="text-[10px] text-white/60 uppercase tracking-widest font-bold">CHOOSE TB</p>

        <div className="grid grid-cols-[1fr,28px,1fr] gap-1 items-start">
          {/* Left: current client talkback channels */}
          <div className="space-y-1.5">
            <p className="text-[8px] text-center font-bold uppercase tracking-widest truncate text-orange-400/70">
              {sourceClient.name}
            </p>
            {Array.from({ length: srcTalkCh }, (_, i) => {
              const ch = i + 1
              const label = clientTalkNames[`talk${ch}`]
              const sel = talkSrcCh === ch
              return (
                <button key={ch} onClick={() => setTalkSrcCh(sel ? null : ch)}
                  className="w-full rounded-lg px-2 py-2.5 transition-all text-left"
                  style={sel
                    ? { background: chColor(ch) + "40", border: `2px solid ${chColor(ch)}`, color: chColor(ch) }
                    : { background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.4)" }}>
                  <div className="text-sm font-black">TB{ch}</div>
                  {label && (
                    <div className="text-[7px] uppercase font-bold truncate mt-0.5"
                      style={{ color: sel ? chColor(ch) : "rgba(255,255,255,0.2)" }}>
                      {label}
                    </div>
                  )}
                </button>
              )
            })}
          </div>

          {/* Arrow */}
          <div className="flex items-center justify-center" style={{ paddingTop: 38 }}>
            <ArrowRight size={14} className="text-white/20" />
          </div>

          {/* Right: destination receive channels */}
          <div className="space-y-1.5">
            <p className="text-[8px] text-center font-bold uppercase tracking-widest truncate text-orange-400/70">
              {destLabel}
            </p>
            {Array.from({ length: dstTalkCh }, (_, i) => {
              const ch = i + 1
              const sel = talkDestCh === ch
              return (
                <button key={ch} onClick={() => setTalkDestCh(sel ? null : ch)}
                  className="w-full rounded-lg px-2 py-2.5 transition-all text-left"
                  style={sel
                    ? { background: chColor(ch) + "40", border: `2px solid ${chColor(ch)}`, color: chColor(ch) }
                    : { background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.4)" }}>
                  <div className="text-sm font-black">TB{ch}</div>
                </button>
              )
            })}
          </div>
        </div>

        {talkSrcCh !== null && talkDestCh !== null && (
          <button onClick={() => setStep("pick-receive")}
            className="w-full py-2.5 rounded-xl text-sm font-bold flex items-center justify-center gap-2"
            style={{ background: "rgba(249,115,22,0.8)", color: "white" }}>
            Next – choose receiving channel <ChevronRight size={14} />
          </button>
        )}
      </div>
    )
  }

  // ── PICK RECEIVE ──
  const renderPickReceive = () => {
    const destLabel = selectedDestIds
      .map(id => clients.find(c => c.id === id)?.name ?? id)
      .join(", ")
    const canConfirm = recvMyCh !== null && recvDestCh !== null && socketOk

    const srcRecvChCount = clientRecvChCount(sourceClient.id)
    const dstRecvChCount = selectedDestIds.length > 0
      ? Math.min(...selectedDestIds.map(id => clientRecvChCount(id)))
      : 0

    // Render a channel-number grid inline (NOT as a component) so React never
    // unmounts/remounts it on parent re-renders — which was causing clicks to
    // visually appear as no-ops.
    const chGrid = (selected: number | null, onSelect: (ch: number) => void, count: number) => (
      <div className="grid grid-cols-2 gap-1">
        {Array.from({ length: count }, (_, i) => {
          const ch = i + 1
          const sel = selected === ch
          return (
            <button key={ch} onClick={() => onSelect(sel ? -1 : ch)}
              className="rounded-lg py-2 transition-all"
              style={sel
                ? { background: chColor(ch) + "40", border: `2px solid ${chColor(ch)}`, color: chColor(ch) }
                : { background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.35)" }}>
              <div className="text-xs font-black">{ch}</div>
            </button>
          )
        })}
      </div>
    )

    return (
      <div className="space-y-3">
        <BackBtn to="pick-talk" />
        <p className="text-[10px] text-white/60 uppercase tracking-widest font-bold">CHOOSE RECEIVING CHANNEL</p>
        <p className="text-[9px] text-white/35">Pick which channel you receive on (left) and which channel {destLabel} sends on (right)</p>

        <div className="grid grid-cols-[1fr,28px,1fr] gap-1 items-start">
          <div className="space-y-1.5">
            <p className="text-[8px] text-center font-bold uppercase tracking-widest truncate text-orange-400/70">
              {sourceClient.name}
            </p>
            {chGrid(recvMyCh, ch => setRecvMyCh(ch < 1 ? null : ch), srcRecvChCount)}
          </div>

          <div className="flex items-center justify-center" style={{ paddingTop: 38 }}>
            <ArrowLeft size={14} className="text-white/20" />
          </div>

          <div className="space-y-1.5">
            <p className="text-[8px] text-center font-bold uppercase tracking-widest truncate text-orange-400/70">
              {destLabel}
            </p>
            {chGrid(recvDestCh, ch => setRecvDestCh(ch < 1 ? null : ch), dstRecvChCount)}
          </div>
        </div>

        {recvMyCh !== null && recvDestCh !== null && (
          <div className="px-3 py-1.5 rounded-lg text-[9px] text-white/45"
            style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}>
            TB{talkSrcCh} → {destLabel} TB{talkDestCh}
            &nbsp;·&nbsp;
            {destLabel} CH{recvDestCh} → receive CH{recvMyCh}
          </div>
        )}

        <button onClick={confirmClientConnections} disabled={!canConfirm}
          className="w-full py-3 rounded-xl text-sm font-bold flex items-center justify-center gap-2"
          style={canConfirm
            ? { background: "#f97316", color: "white" }
            : { background: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.3)" }}>
          <Check size={14} />
          CONFIRM{selectedDestIds.length > 1 ? ` (${selectedDestIds.length} clients)` : ""}
        </button>
      </div>
    )
  }

  // ── SOUNDCARD: PICK SOURCE ──
  const renderScPickSrc = () => (
    <div className="space-y-3">
      <BackBtn to="reset" />
      <p className="text-[10px] text-white/60 uppercase tracking-widest font-bold">SELECT AUDIO INTERFACE INPUT</p>

      {/* Stereo pairs — shown at top in purple */}
      {stereoPairs.length > 0 && (
        <>
          <div className="flex items-center gap-1.5 px-1">
            <div className="flex-1 h-px" style={{ background: `${STEREO_COLOR}30` }} />
            <span className="text-[8px] font-black uppercase tracking-widest" style={{ color: `${STEREO_COLOR}99` }}>Stereo</span>
            <div className="flex-1 h-px" style={{ background: `${STEREO_COLOR}30` }} />
          </div>
          {stereoPairs.map(pair => {
            const assignedStereo = incoming.find(c => c.from === `bridge-stereo-${pair.chL}-${pair.chR}`)
            return (
              <button key={pair.id}
                onClick={() => { setScSrcId(`bridge-stereo-${pair.chL}-${pair.chR}`); setScSrcName(pair.name); setScIsStereo(true); setStep("sc-pick-recv-ch") }}
                className="w-full flex items-center gap-2 px-3 py-2.5 rounded-lg transition-all"
                style={assignedStereo
                  ? { background: `${STEREO_COLOR}15`, border: `1px solid ${STEREO_COLOR}50`, color: "rgba(255,255,255,0.9)" }
                  : { background: `${STEREO_COLOR}08`, border: `1px solid ${STEREO_COLOR}25`, color: "rgba(255,255,255,0.8)" }}>
                <span className="text-[8px] font-black px-1.5 py-0.5 rounded shrink-0"
                  style={{ background: `${STEREO_COLOR}25`, color: STEREO_COLOR, border: `1px solid ${STEREO_COLOR}50` }}>
                  L+R
                </span>
                <span className="text-sm font-bold flex-1 text-left">{pair.name}</span>
                <span className="text-[9px] font-mono shrink-0" style={{ color: `${STEREO_COLOR}70` }}>
                  CH{pair.chL}+{pair.chR}
                </span>
                {assignedStereo
                  ? <span className="text-[9px] font-bold ml-1" style={{ color: STEREO_COLOR }}>CH{assignedStereo.channel} ✓</span>
                  : <ChevronRight size={12} className="text-white/25 ml-1" />}
              </button>
            )
          })}
          <div className="flex items-center gap-1.5 px-1">
            <div className="flex-1 h-px bg-white/5" />
            <span className="text-[8px] font-black uppercase tracking-widest text-white/20">Mono</span>
            <div className="flex-1 h-px bg-white/5" />
          </div>
        </>
      )}

      {inputBridgeChs.length === 0 && stereoPairs.length === 0 && (
        <p className="text-[11px] text-white/50 italic text-center py-4">
          No audio interface inputs – start Audio Bridge
        </p>
      )}
      {inputBridgeChs.map(ch => {
        const assigned = incoming.find(c => c.from === `bridge-ch${ch.channel}`)
        return (
          <button key={ch.channel}
            onClick={() => { setScSrcId(`bridge-ch${ch.channel}`); setScSrcName(ch.name); setScIsStereo(false); setStep("sc-pick-recv-ch") }}
            className="w-full flex items-center gap-2 px-3 py-2.5 rounded-lg transition-all"
            style={assigned
              ? { background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.3)", color: "rgba(255,255,255,0.9)" }
              : { background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.7)" }}>
            <span className="text-[9px] font-mono text-white/40 w-5 text-right shrink-0">{ch.channel}</span>
            <span className="text-[8px] font-black px-1.5 py-0.5 rounded shrink-0"
              style={{ background: "rgba(34,197,94,0.2)", color: "#22c55e", border: "1px solid rgba(34,197,94,0.3)" }}>
              IN
            </span>
            <span className="text-sm font-bold flex-1 text-left">{ch.name}</span>
            {assigned
              ? <span className="text-[9px] font-bold" style={{ color: "#22c55e" }}>CH{assigned.channel} ✓</span>
              : <ChevronRight size={12} className="text-white/25" />}
          </button>
        )
      })}
    </div>
  )

  // ── SOUNDCARD: PICK RECEIVE CHANNEL ──
  const renderScPickRecvCh = () => {
    const activePair = scIsStereo ? stereoPairs.find(p => scSrcId === `bridge-stereo-${p.chL}-${p.chR}`) : null
    return (
    <div className="space-y-3">
      <BackBtn to="sc-pick-src" />
      <div className="px-3 py-2 rounded-lg"
        style={scIsStereo
          ? { background: `${STEREO_COLOR}12`, border: `1px solid ${STEREO_COLOR}40` }
          : { background: "rgba(59,130,246,0.08)", border: "1px solid rgba(59,130,246,0.2)" }}>
        <p className="text-[9px] text-white/50 uppercase tracking-widest">{scIsStereo ? "Stereo source" : "Source"}</p>
        <p className="text-sm font-bold text-white">{scSrcName}</p>
        {scIsStereo && activePair && (
          <p className="text-[9px] font-mono mt-0.5" style={{ color: `${STEREO_COLOR}90` }}>
            L: CH{activePair.chL} · R: CH{activePair.chR} · true stereo WebRTC
          </p>
        )}
      </div>
      <p className="text-[10px] text-white/60 uppercase tracking-widest font-bold">
        SELECT RECEIVE CHANNEL
      </p>
      <div className="grid grid-cols-4 gap-1.5">
        {Array.from({ length: clientRecvChCount(sourceClient.id) }, (_, i) => {
          const ch = i + 1
          const sel = scRecvCh === ch
          return (
            <button key={ch} onClick={() => setScRecvCh(sel ? null : ch)}
              className="rounded-lg p-2.5 transition-all"
              style={sel
                ? { background: (scIsStereo ? STEREO_COLOR : chColor(ch)) + "40", border: `2px solid ${scIsStereo ? STEREO_COLOR : chColor(ch)}`, color: scIsStereo ? STEREO_COLOR : chColor(ch) }
                : { background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.3)" }}>
              <div className="text-sm font-black">CH{ch}</div>
            </button>
          )
        })}
      </div>
      {scRecvCh !== null && activePair && (
        <button onClick={() => confirmConnectStereoInput(activePair)} disabled={!socketOk}
          className="w-full py-3 rounded-xl text-sm font-bold flex items-center justify-center gap-2"
          style={socketOk
            ? { background: STEREO_COLOR, color: "white" }
            : { background: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.3)" }}>
          <Check size={14} /> {scSrcName} (L+R) → CH{scRecvCh}
        </button>
      )}
      {scRecvCh !== null && !activePair && (
        <button onClick={confirmConnectSoundcardInput} disabled={!socketOk}
          className="w-full py-3 rounded-xl text-sm font-bold flex items-center justify-center gap-2"
          style={socketOk
            ? { background: "#3b82f6", color: "white" }
            : { background: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.3)" }}>
          <Check size={14} /> {scSrcName} → CH{scRecvCh}
        </button>
      )}
    </div>
  )
  }

  // ── OUTPUT: PICK MY CHANNEL ──
  const renderOutputPickMyCh = () => {
    const myTalkCh = clientTalkChCount(sourceClient.id)
    return (
      <div className="space-y-3">
        <BackBtn to="reset" />
        <p className="text-[10px] text-white/60 uppercase tracking-widest font-bold">
          SELECT TB CHANNEL TO SEND
        </p>
        <p className="text-[9px] text-white/35">Tap to toggle — multiple channels can be selected</p>
        <div className="grid grid-cols-4 gap-1.5">
          {Array.from({ length: myTalkCh }, (_, i) => {
            const ch = i + 1
            const label = clientTalkNames[`talk${ch}`]
            const sel = selectedMyOutputChs.includes(ch)
            return (
              <button key={ch}
                onClick={() => setSelectedMyOutputChs(prev =>
                  prev.includes(ch) ? prev.filter(x => x !== ch) : [...prev, ch]
                )}
                className="rounded-lg p-2.5 transition-all"
                style={sel
                  ? { background: chColor(ch) + "40", border: `2px solid ${chColor(ch)}`, color: chColor(ch) }
                  : { background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.3)" }}>
                <div className="text-sm font-black">TB{ch}</div>
                {label && (
                  <div className="text-[7px] uppercase font-bold truncate mt-0.5"
                    style={{ color: sel ? chColor(ch) : "rgba(255,255,255,0.2)" }}>
                    {label}
                  </div>
                )}
              </button>
            )
          })}
        </div>
        {selectedMyOutputChs.length > 0 && (
          <button onClick={() => { fetchServerOutputDevices(); setStep("output-pick-device") }}
            className="w-full py-2.5 rounded-xl text-sm font-bold flex items-center justify-center gap-2"
            style={{ background: "rgba(34,197,94,0.8)", color: "white" }}>
            {selectedMyOutputChs.length > 1 ? `${selectedMyOutputChs.length} channels selected` : `TB${selectedMyOutputChs[0]} selected`} – choose device <ChevronRight size={14} />
          </button>
        )}
      </div>
    )
  }

  // ── OUTPUT: PICK SOUNDCARD CHANNEL ──
  const renderOutputPickSoundcard = () => {
    const tbLabel = selectedMyOutputChs.map(ch => `TB${ch}`).join("+")
    const devName = serverOutputDevices.find(d => d.id === selectedServerDevice)?.name ?? "default"
    const scName = outputBridgeChs.find(c => c.channel === selectedSoundcardCh)?.name ?? (selectedSoundcardCh ? `CH${selectedSoundcardCh}` : "")
    const canConfirm = selectedSoundcardCh !== null && socketOk
    return (
      <div className="space-y-3">
        <BackBtn to="output-pick-device" />
        <div className="grid grid-cols-2 gap-2">
          <div className="px-3 py-2 rounded-lg"
            style={{ background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.2)" }}>
            <p className="text-[9px] text-white/50 uppercase tracking-widest">Sending</p>
            <p className="text-sm font-bold text-green-400">{tbLabel}</p>
          </div>
          <div className="px-3 py-2 rounded-lg"
            style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)" }}>
            <p className="text-[9px] text-white/50 uppercase tracking-widest">Device</p>
            <p className="text-xs font-bold text-white/70 truncate">{devName}</p>
          </div>
        </div>
        <p className="text-[10px] text-white/60 uppercase tracking-widest font-bold">SELECT OUTPUT CHANNEL</p>
        {outputBridgeChs.length === 0 && (
          <p className="text-[11px] text-white/50 italic text-center py-4">
            No audio interface outputs – start Audio Bridge
          </p>
        )}
        <div className="space-y-1 max-h-[200px] overflow-y-auto pr-1">
          {outputBridgeChs.map(ch => (
            <button key={ch.channel}
              onClick={() => setSelectedSoundcardCh(selectedSoundcardCh === ch.channel ? null : ch.channel)}
              className="w-full flex items-center gap-2 px-3 py-2.5 rounded-lg transition-all"
              style={selectedSoundcardCh === ch.channel
                ? { background: "rgba(34,197,94,0.2)", border: "1px solid rgba(34,197,94,0.5)", color: "white" }
                : { background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.6)" }}>
              <span className="text-[9px] font-mono text-white/40 w-5 text-right shrink-0">{ch.channel}</span>
              <span className="text-[8px] font-black px-1.5 py-0.5 rounded shrink-0"
                style={{ background: "rgba(59,130,246,0.2)", color: "#3b82f6", border: "1px solid rgba(59,130,246,0.3)" }}>
                OUT
              </span>
              <span className="text-sm font-bold flex-1 text-left">{ch.name}</span>
              {selectedSoundcardCh === ch.channel && <Check size={12} className="text-green-400" />}
            </button>
          ))}
        </div>
        {canConfirm && (
          <button onClick={confirmConnectOutput}
            className="w-full py-3 rounded-xl text-sm font-bold flex items-center justify-center gap-2"
            style={{ background: "#22c55e", color: "white" }}>
            <Check size={14} />
            Confirm — {tbLabel} → {scName}
          </button>
        )}
      </div>
    )
  }

  // ── OUTPUT: PICK SERVER DEVICE ──
  const renderOutputPickDevice = () => {
    const tbLabel = selectedMyOutputChs.map(ch => `TB${ch}`).join("+")
    const canNext = selectedServerDevice >= 0 || serverOutputDevices.length === 0
    return (
      <div className="space-y-3">
        <BackBtn to="output-pick-my-ch" />
        <div className="px-3 py-2 rounded-lg"
          style={{ background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.2)" }}>
          <p className="text-[9px] text-white/50 uppercase tracking-widest">Sending</p>
          <p className="text-sm font-bold text-green-400">{tbLabel}</p>
        </div>

        <p className="text-[10px] text-white/60 uppercase tracking-widest font-bold">SELECT OUTPUT DEVICE</p>
        <p className="text-[9px] text-white/35">Which audio interface the server should output to</p>

        {serverOutputDevices.length === 0 ? (
          <div className="text-center py-4 space-y-1">
            <p className="text-[11px] text-white/40 italic">No server output devices found</p>
            <p className="text-[10px] text-white/25">Will use system default</p>
          </div>
        ) : (
          <div className="space-y-1 max-h-[180px] overflow-y-auto pr-1">
            {serverOutputDevices.map(d => (
              <button key={d.id}
                onClick={() => { setSelectedServerDevice(d.id); setSelectedDeviceChannels(Math.min(d.maxOutputChannels, 32)) }}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-lg transition-all text-left"
                style={selectedServerDevice === d.id
                  ? { background: "rgba(34,197,94,0.15)", border: "1px solid rgba(34,197,94,0.4)", color: "white" }
                  : { background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.7)" }}>
                <span className="text-[9px] font-mono text-white/30 w-6 text-right shrink-0">{d.id}</span>
                <span className="text-sm font-bold flex-1 truncate">{d.name}</span>
                <span className="text-[8px] text-white/30 shrink-0">{d.maxOutputChannels}ch</span>
                {selectedServerDevice === d.id && <Check size={11} className="text-green-400 shrink-0" />}
              </button>
            ))}
          </div>
        )}

        {selectedServerDevice >= 0 && (
          <div className="space-y-1">
            <p className="text-[10px] text-white/50 uppercase tracking-widest font-bold">TOTAL DEVICE CHANNELS</p>
            <p className="text-[9px] text-white/30">Must match the device's actual channel count for correct interleaving</p>
            <div className="flex gap-1 flex-wrap">
              {[2, 4, 8, 16, 32, 64].filter(n => n <= (serverOutputDevices.find(d => d.id === selectedServerDevice)?.maxOutputChannels ?? 2)).map(n => (
                <button key={n} onClick={() => setSelectedDeviceChannels(n)}
                  className="px-3 py-1.5 rounded-lg text-xs font-bold transition-all"
                  style={selectedDeviceChannels === n
                    ? { background: "rgba(34,197,94,0.3)", border: "1px solid rgba(34,197,94,0.6)", color: "#22c55e" }
                    : { background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.4)" }}>
                  {n}ch
                </button>
              ))}
            </div>
          </div>
        )}

        {canNext && (
          <button onClick={() => setStep("output-pick-soundcard")}
            className="w-full py-2.5 rounded-xl text-sm font-bold flex items-center justify-center gap-2"
            style={{ background: "rgba(34,197,94,0.8)", color: "white" }}>
            Next – select output channel <ChevronRight size={14} />
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 pointer-events-none">
      <div
        className="pointer-events-auto absolute bg-zinc-900 border border-white/10 rounded-2xl w-[480px] shadow-2xl flex flex-col"
        style={{ left: pos.x, top: pos.y, maxHeight: "85vh" }}>
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4 border-b border-white/5 shrink-0 cursor-grab active:cursor-grabbing select-none"
          onMouseDown={onMouseDown}>
          <div className="flex items-center gap-2">
            <GripHorizontal size={14} className="text-white/20 shrink-0" />
            <div>
              <h2 className="text-white font-bold">{sourceClient.name}</h2>
              <div className="flex items-center gap-2 mt-0.5">
                {socketOk
                  ? <><Wifi size={10} className="text-green-400" /><span className="text-[9px] text-green-400">Connected</span></>
                  : <><WifiOff size={10} className="text-red-400" /><span className="text-[9px] text-red-400">Not connected</span></>}
                {isMobile && <span className="text-[9px] text-orange-400/60">· Mobile</span>}
              </div>
            </div>
          </div>
          <div className="flex gap-1">
            <button
              onClick={() => {
                socket.emit("connections:request:all")
                socket.emit("audio:bridge:channelInfo", (i: any) => Array.isArray(i) && setBridgeChannels(i))
              }}
              className="p-1.5 bg-white/5 hover:bg-white/10 rounded text-white/40 hover:text-white">
              <RefreshCw size={13} />
            </button>
            <button onClick={onClose} className="p-1.5 bg-white/5 hover:bg-white/10 rounded text-white/40 hover:text-white">
              <X size={13} />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto px-5 py-4 min-h-0">
          {step === "overview" && renderOverview()}
          {step === "pick-destinations" && renderPickDestinations()}
          {step === "pick-talk" && renderPickTalk()}
          {step === "pick-receive" && renderPickReceive()}
          {step === "sc-pick-src" && renderScPickSrc()}
          {step === "sc-pick-recv-ch" && renderScPickRecvCh()}
          {step === "output-pick-my-ch" && renderOutputPickMyCh()}
          {step === "output-pick-soundcard" && renderOutputPickSoundcard()}
          {step === "output-pick-device" && renderOutputPickDevice()}
        </div>
      </div>
    </div>
  )
}
