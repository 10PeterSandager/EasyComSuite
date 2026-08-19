import React, { useState, useRef, useEffect, useCallback } from 'react'
import { socket } from '../client/webrtc/intercom'
import { Client } from '../types'
import { Play, Square, AlertCircle, Trash2, Check, X, Pencil, Tv, Video, Monitor, Volume2, VolumeX } from 'lucide-react'

interface VideoTabProps {
  clients: Client[]
  updateClient: (id: string, updates: Partial<Client>) => void
  theme: 'orange' | 'blue'
  videoStream1: MediaStream | null
  videoStream2: MediaStream | null
  videoStream3?: MediaStream | null
  videoStream4?: MediaStream | null
  startVideoStream: (channel: number, deviceId?: string, existingStream?: MediaStream) => Promise<void>
  stopVideoStream: (channel: number) => void
  selectedIds: string[]
  updateMultipleClients: (ids: string[], updates: Partial<Client>) => void
  onClientMark: (id: string, e: React.MouseEvent) => void
  onRoutingChange?: (clientId: string, videoSources: number[]) => void
}

const SOURCE_LABELS_KEY = "easycom_video_labels"
const DEVICE_SELECTION_KEY = "easycom_video_devices"
const DEFAULT_LABELS: Record<number, string> = { 1: "INPUT 1", 2: "INPUT 2", 3: "INPUT 3", 4: "INPUT 4" }

function loadLabels(): Record<number, string> {
  try {
    const stored = JSON.parse(localStorage.getItem(SOURCE_LABELS_KEY) || "{}")
    // Nulstil hvis labels indeholder kendte fejlværdier fra tidligere
    const merged = { ...DEFAULT_LABELS, ...stored }
    const bad = ['TEAST', 'TEST', 'IN1', 'IN2', 'IN3', 'IN4']
    for (const [k, v] of Object.entries(merged)) {
      if (bad.includes(v as string)) merged[Number(k)] = DEFAULT_LABELS[Number(k)]
    }
    return merged
  } catch { return { ...DEFAULT_LABELS } }
}

function saveLabels(labels: Record<number, string>) {
  try { localStorage.setItem(SOURCE_LABELS_KEY, JSON.stringify(labels)) } catch {}
}

// Animated SMPTE test pattern
function TestPattern({ label, ch, onStream }: { label: string; ch?: number; onStream?: (stream: MediaStream) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rafRef = useRef<number>(0)
  const frame = useRef(0)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const draw = () => {
      rafRef.current = requestAnimationFrame(draw)
      const ctx = canvas.getContext("2d")
      if (!ctx) return
      const w = canvas.width, h = canvas.height
      const bars = ["#c0c0c0","#c0c000","#00c0c0","#00c000","#c000c0","#c00000","#0000c0"]
      bars.forEach((color, i) => {
        ctx.fillStyle = color
        ctx.fillRect(i * w / 7, 0, w / 7, h * 0.7)
      })
      const row2 = ["#0000c0","#131313","#c000c0","#131313","#00c0c0","#131313","#c0c0c0"]
      row2.forEach((color, i) => {
        ctx.fillStyle = color
        ctx.fillRect(i * w / 7, h * 0.7, w / 7, h * 0.08)
      })
      ctx.fillStyle = "#131313"
      ctx.fillRect(0, h * 0.78, w, h * 0.22)
      ctx.fillStyle = "#ffffff"
      ctx.fillRect(w * 0.25, h * 0.78, w * 0.1, h * 0.22)

      // Overlay
      ctx.fillStyle = "rgba(0,0,0,0.5)"
      ctx.fillRect(0, h * 0.34, w, 40)
      ctx.fillStyle = "#fff"
      ctx.font = `bold 14px monospace`
      ctx.textAlign = "center"
      ctx.fillText(label.toUpperCase(), w / 2, h * 0.34 + 14)
      ctx.font = "11px monospace"
      ctx.fillStyle = "#22c55e"
      ctx.fillText(new Date().toISOString().slice(11, 19), w / 2, h * 0.34 + 30)

      // REC blink
      if (frame.current % 60 < 30) {
        ctx.fillStyle = "#ef4444"
        ctx.beginPath(); ctx.arc(w - 14, 12, 6, 0, Math.PI * 2); ctx.fill()
      }
      frame.current++
    }
    rafRef.current = requestAnimationFrame(draw)

    // 🔥 Capture canvas stream og send til parent – delay så canvas er tegnet
    if (onStream && (canvas as any).captureStream) {
      setTimeout(() => {
        const stream = (canvas as any).captureStream(25)
        console.log(`[TestPattern] captureStream: ${stream.getVideoTracks().length} video tracks`)
        onStream(stream)
      }, 200)
    }

    return () => cancelAnimationFrame(rafRef.current)
  }, [label])

  return <canvas ref={canvasRef} width={320} height={180} className="w-full h-full object-cover" />
}


const CUSTOM_PATTERNS_KEY = "easycom_custom_patterns"

type CustomPattern = {
  id: string
  name: string
  bgImage: string | null   // base64
  text: string
  textColor: string
  textSize: number
  textPos: "top" | "center" | "bottom"
  createdAt: number
}

function loadPatterns(): CustomPattern[] {
  try { return JSON.parse(localStorage.getItem(CUSTOM_PATTERNS_KEY) || "[]") } catch { return [] }
}
function savePatterns(p: CustomPattern[]) {
  try { localStorage.setItem(CUSTOM_PATTERNS_KEY, JSON.stringify(p)) } catch {} 
}

function CustomTestCreator({ onSelect, accentColor }: { onSelect: (p: CustomPattern) => void; accentColor: string }) {
  const [patterns, setPatterns] = useState<CustomPattern[]>(loadPatterns)
  const [editing, setEditing] = useState<CustomPattern | null>(null)
  const [open, setOpen] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const blank = (): CustomPattern => ({
    id: Date.now().toString(),
    name: "My test pattern",
    bgImage: null,
    text: "TEST",
    textColor: "#ffffff",
    textSize: 48,
    textPos: "center",
    createdAt: Date.now()
  })

  const renderPreview = useCallback((p: CustomPattern, canvas: HTMLCanvasElement) => {
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    const w = canvas.width, h = canvas.height

    if (p.bgImage) {
      const img = new Image()
      img.onload = () => {
        ctx.drawImage(img, 0, 0, w, h)
        drawText(ctx, p, w, h)
      }
      img.src = p.bgImage
    } else {
      // Gradient bg
      const grad = ctx.createLinearGradient(0, 0, w, h)
      grad.addColorStop(0, "#1a1a2e"); grad.addColorStop(1, "#16213e")
      ctx.fillStyle = grad; ctx.fillRect(0, 0, w, h)
      drawText(ctx, p, w, h)
    }
  }, [])

  const drawText = (ctx: CanvasRenderingContext2D, p: CustomPattern, w: number, h: number) => {
    ctx.font = `bold ${p.textSize}px sans-serif`
    ctx.textAlign = "center"
    const y = p.textPos === "top" ? p.textSize + 20 : p.textPos === "bottom" ? h - 30 : h / 2
    ctx.fillStyle = "rgba(0,0,0,0.5)"
    ctx.fillText(p.text, w / 2 + 2, y + 2)
    ctx.fillStyle = p.textColor
    ctx.fillText(p.text, w / 2, y)
  }

  useEffect(() => {
    if (!canvasRef.current || !editing) return
    renderPreview(editing, canvasRef.current)
  }, [editing, renderPreview])

  const handleImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !editing) return
    const reader = new FileReader()
    reader.onload = ev => {
      setEditing(prev => prev ? { ...prev, bgImage: ev.target?.result as string } : prev)
    }
    reader.readAsDataURL(file)
  }

  const save = () => {
    if (!editing) return
    const updated = patterns.some(p => p.id === editing.id)
      ? patterns.map(p => p.id === editing.id ? editing : p)
      : [...patterns, editing]
    setPatterns(updated); savePatterns(updated); setEditing(null)
  }

  const remove = (id: string) => {
    const updated = patterns.filter(p => p.id !== id)
    setPatterns(updated); savePatterns(updated)
  }

  if (!open) return (
    <button onClick={() => setOpen(true)}
      className="w-full py-1.5 rounded-lg text-[9px] font-bold flex items-center justify-center gap-1 mt-1"
      style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.4)" }}>
      + Create custom test pattern
    </button>
  )

  return (
    <div className="mt-2 rounded-xl overflow-hidden"
      style={{ background: "rgba(0,0,0,0.3)", border: "1px solid rgba(255,255,255,0.1)" }}>

      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2"
        style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        <span className="text-[10px] font-bold text-white/70">Custom test patterns</span>
        <button onClick={() => { setOpen(false); setEditing(null) }}
          className="text-white/30 hover:text-white text-[10px]">✕</button>
      </div>

      <div className="p-3 space-y-3 overflow-y-auto" style={{ maxHeight: "340px", scrollbarWidth: "thin", scrollbarColor: "rgba(255,255,255,0.15) transparent" }}>

        {/* Saved patterns list */}
        {patterns.length > 0 && (
          <div className="space-y-1">
            {patterns.map(p => (
              <div key={p.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg"
                style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}>
                <span className="flex-1 text-xs text-white/70 font-medium truncate">{p.name}</span>
                <button onClick={() => { onSelect(p); setOpen(false) }}
                  className="text-[8px] font-bold px-2 py-1 rounded"
                  style={{ background: `${accentColor}25`, color: accentColor, border: `1px solid ${accentColor}40` }}>
                  USE
                </button>
                <button onClick={() => setEditing({ ...p })}
                  className="text-[8px] px-2 py-1 rounded text-white/40 hover:text-white"
                  style={{ background: "rgba(255,255,255,0.05)" }}>
                  ✏️
                </button>
                <button onClick={() => remove(p.id)}
                  className="text-[8px] px-1.5 py-1 rounded text-red-400/60 hover:text-red-400"
                  style={{ background: "rgba(239,68,68,0.08)" }}>
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Editor */}
        {editing ? (
          <div className="space-y-2.5 pt-1" style={{ borderTop: patterns.length > 0 ? "1px solid rgba(255,255,255,0.06)" : "none", paddingTop: patterns.length > 0 ? "12px" : "0" }}>
            <canvas ref={canvasRef} width={320} height={180}
              className="rounded-lg" style={{ border: "1px solid rgba(255,255,255,0.1)", width: "50%", display: "block" }} />

            <input value={editing.name} onChange={e => setEditing(p => p ? { ...p, name: e.target.value } : p)}
              placeholder="Pattern name"
              className="w-full bg-black/60 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white" />

            <div className="flex gap-2">
              <input value={editing.text} onChange={e => setEditing(p => p ? { ...p, text: e.target.value } : p)}
                placeholder="Tekst"
                className="flex-1 bg-black/60 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white" />
              <input type="color" value={editing.textColor}
                onChange={e => setEditing(p => p ? { ...p, textColor: e.target.value } : p)}
                className="w-9 h-8 rounded cursor-pointer border border-white/10 bg-black/60" />
            </div>

            <div className="flex gap-2 items-center">
              <span className="text-[9px] text-white/40">Size</span>
              <input type="range" min={16} max={96} value={editing.textSize}
                onChange={e => setEditing(p => p ? { ...p, textSize: Number(e.target.value) } : p)}
                className="flex-1 h-1" />
              <span className="text-[9px] text-white/40 w-6">{editing.textSize}</span>
            </div>

            <div className="flex gap-1">
              {(["top","center","bottom"] as const).map(pos => (
                <button key={pos} onClick={() => setEditing(p => p ? { ...p, textPos: pos } : p)}
                  className="flex-1 py-1 rounded text-[9px] font-bold capitalize"
                  style={editing.textPos === pos
                    ? { background: `${accentColor}25`, color: accentColor, border: `1px solid ${accentColor}50` }
                    : { background: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.4)", border: "1px solid rgba(255,255,255,0.08)" }}>
                  {pos === "top" ? "Top" : pos === "center" ? "Center" : "Bottom"}
                </button>
              ))}
            </div>

            <div className="flex gap-2">
              <button onClick={() => fileRef.current?.click()}
                className="flex-1 py-1.5 rounded-lg text-[9px] font-bold"
                style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.5)" }}>
                {editing.bgImage ? "Change background" : "Upload background"}
              </button>
              {editing.bgImage && (
                <button onClick={() => setEditing(p => p ? { ...p, bgImage: null } : p)}
                  className="px-2 py-1.5 rounded-lg text-[9px] text-red-400/70 hover:text-red-400"
                  style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.15)" }}>
                  Remove
                </button>
              )}
            </div>
            <input ref={fileRef} type="file" accept="image/*" onChange={handleImage} className="hidden" />

            <div className="flex gap-2 pt-1">
              <button onClick={() => setEditing(null)}
                className="flex-1 py-2 rounded-lg text-[10px] font-bold text-white/40 hover:text-white"
                style={{ background: "rgba(255,255,255,0.05)" }}>
                Cancel
              </button>
              <button onClick={save}
                className="flex-[2] py-2 rounded-lg text-[10px] font-bold text-white"
                style={{ background: accentColor }}>
                Save pattern
              </button>
            </div>
          </div>
        ) : (
          <button onClick={() => setEditing(blank())}
            className="w-full py-2 rounded-lg text-[10px] font-bold"
            style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.5)" }}>
            + New pattern
          </button>
        )}
      </div>
    </div>
  )
}

// Stabil preview komponent – srcObject sættes via useEffect, aldrig re-mounted
function SlotPreview({ stream, label, color }: { stream: MediaStream | null | undefined, label: string, color: string }) {
  const ref = React.useRef<HTMLVideoElement>(null)
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream ?? null
  }, [stream])
  const active = !!stream
  return (
    <div style={{ width: 180, background: '#000', border: `2px solid ${active ? color : 'rgba(255,255,255,0.1)'}`, borderRadius: 8, overflow: 'hidden' }}>
      <div className="flex items-center gap-1.5 px-2 py-1" style={{ background: active ? color + '22' : 'rgba(0,0,0,0.5)' }}>
        <div className="w-1.5 h-1.5 rounded-full" style={{ background: active ? color : '#444' }} />
        <span className="text-[9px] font-black uppercase tracking-widest" style={{ color: active ? color : '#555' }}>
          {label}
        </span>
      </div>
      <video ref={ref} playsInline muted autoPlay
        style={{ width: '100%', height: 101, objectFit: 'contain', background: '#000', display: 'block' }} />
    </div>
  )
}


const VideoTab: React.FC<VideoTabProps> = ({
  clients, updateClient, theme,
  videoStream1, videoStream2, videoStream3, videoStream4,
  startVideoStream, stopVideoStream,
  selectedIds, updateMultipleClients, onClientMark, onRoutingChange
}) => {
  const videoRef1 = useRef<HTMLVideoElement | null>(null)
  const videoRef2 = useRef<HTMLVideoElement | null>(null)
  const videoRef3 = useRef<HTMLVideoElement | null>(null)
  const videoRef4 = useRef<HTMLVideoElement | null>(null)

  const [labels, setLabels] = useState<Record<number, string>>(loadLabels)
  const [editingCh, setEditingCh] = useState<number | null>(null)
  const [editValue, setEditValue] = useState("")
  const [testMode, setTestMode] = useState<Record<number, boolean>>(() => ({
    1: !videoStream1,
    2: !videoStream2,
    3: !videoStream3,
    4: !videoStream4,
  }))
  const [audioMuted, setAudioMuted] = useState<Record<number, boolean>>({ 1: false, 2: false, 3: false, 4: false })
  const [hasEmbeddedAudio, setHasEmbeddedAudio] = useState<Record<number, boolean>>({})
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([])
  const [selectedDeviceId, setSelectedDeviceId] = useState<Record<number, string>>({})
  const [cameraError, setCameraError] = useState<Record<number, string>>({})

  const reEnumerate = () => {
    if (!navigator.mediaDevices) return
    navigator.mediaDevices.enumerateDevices().then(devices =>
      setVideoDevices(devices.filter(d => d.kind === 'videoinput'))
    )
  }

  useEffect(() => {
    if (!navigator.mediaDevices) return
    reEnumerate()
    navigator.mediaDevices.addEventListener('devicechange', reEnumerate)
    return () => navigator.mediaDevices.removeEventListener('devicechange', reEnumerate)
  }, [])

  // Keep a ref to testMode so the unmount cleanup can read the latest value
  const testModeRef = React.useRef(testMode)
  testModeRef.current = testMode

  useEffect(() => {
    // On mount: if a channel has a lingering stream but no device selected,
    // it's a dead canvas stream from a previous mount – reset to test-pattern mode
    const toReset: number[] = []
    if (videoStream1 && !selectedDeviceId[1]) toReset.push(1)
    if (videoStream2 && !selectedDeviceId[2]) toReset.push(2)
    if (videoStream3 && !selectedDeviceId[3]) toReset.push(3)
    if (videoStream4 && !selectedDeviceId[4]) toReset.push(4)
    if (toReset.length > 0)
      setTestMode(prev => { const n = { ...prev }; toReset.forEach(ch => { n[ch] = true }); return n })

    // On unmount: stop canvas streams so they don't survive as dead streams
    return () => {
      ;[1, 2, 3, 4].forEach(ch => { if (testModeRef.current[ch]) stopVideoStream(ch) })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const selectDevice = async (ch: number, value: string) => {
    if (!value) return
    setSelectedDeviceId(prev => {
      const next = { ...prev, [ch]: value }
      try { localStorage.setItem(DEVICE_SELECTION_KEY, JSON.stringify(next)) } catch {}
      return next
    })
    setCameraError(prev => ({ ...prev, [ch]: '' }))
    const realId = (value === '__default__' || value.startsWith('__idx_')) ? undefined : value
    try {
      await startVideoStream(ch, realId)
      setTestMode(prev => ({ ...prev, [ch]: false }))
      reEnumerate()
    } catch {
      setSelectedDeviceId(prev => ({ ...prev, [ch]: '' }))
      setCameraError(prev => ({ ...prev, [ch]: 'Access denied – check System Preferences → Privacy & Security → Camera → enable Electron' }))
    }
  }

  const toggleAudioMute = async (ch: number) => {
    const newMuted = !audioMuted[ch]
    setAudioMuted(prev => ({ ...prev, [ch]: newMuted }))
    try {
      const { setVideoAudioMute } = await import('../client/webrtc/mediasoupClient')
      setVideoAudioMute(ch, newMuted)
    } catch (e) {
      console.warn('[VideoTab] audio mute fejl:', e)
    }
  }
  const [enabled, setEnabled] = useState<Record<number, boolean>>({ 1: true, 2: true, 3: true, 4: true })

  // Mini player per channel
  const [playerFiles, setPlayerFiles] = useState<Record<number, string | null>>({ 1: null, 2: null, 3: null, 4: null })
  const [playerPlaying, setPlayerPlaying] = useState<Record<number, boolean>>({})
  const [playerLoop, setPlayerLoop] = useState<Record<number, boolean>>({})
  const [playerProgress, setPlayerProgress] = useState<Record<number, number>>({})
  const playerRefs = useRef<Record<number, HTMLVideoElement | null>>({ 1: null, 2: null, 3: null, 4: null })
  const playerFileRefs = useRef<Record<number, HTMLInputElement | null>>({})

  const playerLoad = (ch: number, file: File) => {
    const url = URL.createObjectURL(file)
    setPlayerFiles(prev => ({ ...prev, [ch]: url }))
    setPlayerPlaying(prev => ({ ...prev, [ch]: false }))
    setTimeout(() => {
      const el = playerRefs.current[ch]
      if (el) { el.src = url; el.load() }
    }, 50)
  }

  const playerPlay = (ch: number) => {
    const el = playerRefs.current[ch]
    if (!el) return
    el.play(); setPlayerPlaying(prev => ({ ...prev, [ch]: true }))
  }

  const playerStop = (ch: number) => {
    const el = playerRefs.current[ch]
    if (!el) return
    el.pause(); el.currentTime = 0; setPlayerPlaying(prev => ({ ...prev, [ch]: false }))
  }

  const playerSeek = (ch: number, delta: number) => {
    const el = playerRefs.current[ch]
    if (!el) return
    el.currentTime = Math.max(0, Math.min(el.duration || 0, el.currentTime + delta))
  }

  const togglePlayerLoop = (ch: number) => {
    const el = playerRefs.current[ch]
    const next = !playerLoop[ch]
    setPlayerLoop(prev => ({ ...prev, [ch]: next }))
    if (el) el.loop = next
  }

  const accentColor = theme === "orange" ? "#f97316" : "#3b82f6"

  const streams: Record<number, MediaStream | null | undefined> = {
    1: videoStream1, 2: videoStream2, 3: videoStream3, 4: videoStream4
  }
  const refs: Record<number, React.MutableRefObject<HTMLVideoElement | null>> = {
    1: videoRef1, 2: videoRef2, 3: videoRef3, 4: videoRef4
  }

  // Keep streams in a ref so stable callbacks can read the latest value without recreating
  const streamsRef = useRef(streams)
  streamsRef.current = streams

  // Stable ref callbacks — created once, never recreated, so video elements don't flicker
  const stableVideoRefs = useRef<Record<number, (el: HTMLVideoElement | null) => void>>({})
  if (Object.keys(stableVideoRefs.current).length === 0) {
    ;[1, 2, 3, 4].forEach(ch => {
      stableVideoRefs.current[ch] = (el: HTMLVideoElement | null) => {
        refs[ch].current = el
        if (el) {
          const s = streamsRef.current[ch]
          if (s) { el.srcObject = s; el.play().catch(() => {}) }
          else el.srcObject = null
        }
      }
    })
  }

  useEffect(() => {
    [1, 2, 3, 4].forEach(ch => {
      const el = refs[ch].current
      const stream = streams[ch]
      if (!el) return
      if (stream) { el.srcObject = stream; el.play().catch(() => {}) }
      else el.srcObject = null
    })
  }, [videoStream1, videoStream2, videoStream3, videoStream4])

  const saveLabel = () => {
    if (editingCh === null) return
    const updated = { ...labels, [editingCh]: editValue.trim() || labels[editingCh] }
    setLabels(updated); saveLabels(updated); setEditingCh(null)
  }

  const setSource = (clientId: string, slot: number, src: number | null) => {
    const c = clients.find(x => x.id === clientId)
    if (!c) return
    const current = [...(c.videoSources ?? [0, 0])]
    while (current.length < 2) current.push(0)
    current[slot] = src ?? 0
    updateClient(clientId, { videoSources: current })
    // 🔥 Send HELE arrayet inkl. nuller så slot-position bevares (index = slot, value = source)
    socket.emit("video:routing:update", { clientId, videoSources: current })
    onRoutingChange?.(clientId, current)
  }

  const toggleTest = (ch: number) => {
    const isTest = !testMode[ch]
    setTestMode(prev => ({ ...prev, [ch]: isTest }))
    // Always stop the current stream (camera or canvas) before switching.
    // Without this, switching TO test leaves the camera's audio track alive as
    // an active mediasoup producer even though the visual shows the test pattern.
    stopVideoStream(ch)
  }

  // Video producing håndteres af App.tsx – ikke VideoTab

  const toggleEnabled = (ch: number) => {
    const next = !enabled[ch]
    setEnabled(prev => ({ ...prev, [ch]: next }))
    if (!next) stopVideoStream(ch)
  }

  // Which source does a client currently receive?
  const getSlot = (c: Client, slot: number): number =>
    (c.videoSources ?? [])[slot] ?? 0

  // F1/F2 previews follow the first selected client's assigned inputs.
  // When no client is selected, fall back to INPUT 1 / INPUT 2.
  const previewClient = selectedIds.length > 0 ? clients.find(c => c.id === selectedIds[0]) : null
  const v1Src = previewClient ? ((previewClient.videoSources ?? [])[0] ?? 0) : 0
  const v2Src = previewClient ? ((previewClient.videoSources ?? [])[1] ?? 0) : 0
  const f1Stream = previewClient ? (v1Src > 0 ? (streams[v1Src] ?? null) : null) : (streams[1] ?? null)
  const f2Stream = previewClient ? (v2Src > 0 ? (streams[v2Src] ?? null) : null) : (streams[2] ?? null)
  const f1Label = previewClient ? `F1 · ${v1Src > 0 ? (labels[v1Src] ?? `INPUT ${v1Src}`) : 'OFF'}` : `F1 · ${labels[1] ?? 'INPUT 1'}`
  const f2Label = previewClient ? `F2 · ${v2Src > 0 ? (labels[v2Src] ?? `INPUT ${v2Src}`) : 'OFF'}` : `F2 · ${labels[2] ?? 'INPUT 2'}`

  return (
    <div className="flex flex-col h-full overflow-hidden relative">



      {/* TOP: 4 source cards + F1/F2 previews */}
      <div className="flex gap-3 p-4 shrink-0 border-b border-white/5">
        <div className="grid grid-cols-4 gap-3 flex-1">
          {[1, 2, 3, 4].map(ch => {
          const stream = streams[ch]
          const active = !!stream
          const isTest = testMode[ch]
          const isEnabled = enabled[ch]
          const isEditing = editingCh === ch

          return (
            <div key={ch}
              className="rounded-xl overflow-hidden"
              style={{
                background: "rgba(255,255,255,0.03)",
                border: `1px solid ${isEnabled && (active || isTest) ? `${accentColor}40` : "rgba(255,255,255,0.07)"}`
              }}>

              {/* Card header */}
              <div className="flex items-center gap-1.5 px-2.5 py-2"
                style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>

                {/* On/off toggle */}
                <button onClick={() => toggleEnabled(ch)}
                  className="shrink-0 w-7 h-4 rounded-full relative transition-all"
                  style={{ background: isEnabled ? accentColor : "rgba(255,255,255,0.1)" }}>
                  <div className="absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all"
                    style={{ left: isEnabled ? "calc(100% - 14px)" : "2px" }} />
                </button>

                {/* Editable label */}
                <div className="flex-1 min-w-0">
                  {isEditing ? (
                    <div className="flex items-center gap-1">
                      <input autoFocus value={editValue}
                        onChange={e => setEditValue(e.target.value)}
                        onKeyDown={e => { if (e.key === "Enter") saveLabel(); if (e.key === "Escape") setEditingCh(null) }}
                        onBlur={saveLabel}
                        className="w-full text-[9px] bg-black border border-orange-400/60 rounded px-1 py-0.5 text-white" />
                      <button onClick={saveLabel} className="text-green-400 shrink-0"><Check size={8} /></button>
                    </div>
                  ) : (
                    <button onClick={() => { setEditingCh(ch); setEditValue(labels[ch]) }}
                      className="flex items-center gap-0.5 group w-full text-left">
                      <span className={`text-[10px] font-bold truncate ${isEnabled ? "text-white/80" : "text-white/25"}`}>
                        {labels[ch]}
                      </span>
                      <Pencil size={7} className="text-white/20 opacity-0 group-hover:opacity-60 shrink-0" />
                    </button>
                  )}
                </div>

                {/* Status dot */}
                <div className="w-1.5 h-1.5 rounded-full shrink-0"
                  style={{ background: isEnabled && (active || isTest) ? "#22c55e" : "rgba(255,255,255,0.1)" }} />
              </div>

              {/* Video area */}
              <div className="relative aspect-video bg-black">
                {isEnabled && isTest
                  ? <TestPattern label={labels[ch]} ch={ch} onStream={stream => startVideoStream(ch, undefined, stream)} />
                  : isEnabled && active
                    ? <video
                      ref={stableVideoRefs.current[ch]}
                      autoPlay playsInline muted className="w-full h-full object-cover"
                    />
                    : <div className="w-full h-full flex items-center justify-center">
                        <AlertCircle size={16} className="text-white/15" />
                      </div>
                }

                {/* Controls overlay */}
                {isEnabled && (
                  <div className="absolute top-1.5 right-1.5 flex gap-1">
                    {/* Audio mute toggle – vises kun hvis der er embedded audio */}
                    {(active || isTest) && (
                      <button
                        onClick={() => toggleAudioMute(ch)}
                        title={audioMuted[ch] ? 'Unmute embedded audio' : 'Mute embedded audio'}
                        className="p-1.5 rounded-lg text-white transition-all"
                        style={{ background: audioMuted[ch] ? "rgba(34,197,94,0.8)" : "rgba(239,68,68,0.6)" }}>
                        {audioMuted[ch] ? <VolumeX size={9} /> : <Volume2 size={9} />}
                      </button>
                    )}
                    {!active && !isTest && (
                      <button onClick={() => startVideoStream(ch)}
                        className="p-1.5 rounded-lg text-white"
                        style={{ background: "#22c55e" }}>
                        <Play size={9} />
                      </button>
                    )}
                    {active && !isTest && (
                      <button onClick={() => stopVideoStream(ch)}
                        className="p-1.5 rounded-lg text-white"
                        style={{ background: "#ef4444" }}>
                        <Square size={9} />
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Footer actions */}
              {isEnabled && (
                <div className="flex flex-col gap-1 px-2 py-1.5">
                  {/* Test pattern toggle */}
                  <button onClick={() => toggleTest(ch)}
                    className="py-1 rounded text-[8px] font-bold flex items-center justify-center gap-0.5"
                    style={isTest
                      ? { background: `${accentColor}25`, color: accentColor, border: `1px solid ${accentColor}50` }
                      : { background: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.35)", border: "1px solid rgba(255,255,255,0.08)" }}>
                    <Tv size={8} /> TEST
                  </button>
                  {/* Camera device selector */}
                  <div style={{ display: "flex", gap: 3 }}>
                    <select
                      value={selectedDeviceId[ch] ?? ''}
                      onChange={e => selectDevice(ch, e.target.value)}
                      style={{
                        flex: 1,
                        background: "rgba(0,0,0,0.6)",
                        border: `1px solid ${selectedDeviceId[ch] ? accentColor + '60' : 'rgba(255,255,255,0.1)'}`,
                        color: selectedDeviceId[ch] ? "rgba(255,255,255,0.8)" : "rgba(255,255,255,0.3)",
                        borderRadius: 6, fontSize: 8, fontWeight: 700,
                        padding: "4px 6px", outline: "none",
                        textTransform: "uppercase", letterSpacing: 1
                      }}
                    >
                      <option value="">— CHOOSE INPUT —</option>
                      <option value="__default__">DEFAULT CAMERA</option>
                      {videoDevices.map((d, i) => (
                        <option key={d.deviceId || i} value={d.deviceId || `__idx_${i}__`}>
                          {d.label || `INPUT ${i + 1}`}
                        </option>
                      ))}
                    </select>
                    <button onClick={reEnumerate} title="Refresh inputs"
                      style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 6, padding: "0 5px", color: "rgba(255,255,255,0.4)", fontSize: 10, cursor: "pointer" }}>
                      ↻
                    </button>
                  </div>
                  {cameraError[ch] && (
                    <div style={{ background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 6, padding: "5px 7px" }}>
                      <p style={{ color: "#ef4444", fontSize: 8, fontWeight: 700, lineHeight: 1.4 }}>⚠ {cameraError[ch]}</p>
                    </div>
                  )}
                </div>
              )}

              {/* Mini video player */}
              {isEnabled && (
                <div className="px-2 pb-2 space-y-1.5">
                  <div className="flex items-center gap-1" style={{ borderTop: "1px solid rgba(255,255,255,0.05)", paddingTop: "6px" }}>
                    <span className="text-[8px] text-white/30 font-bold uppercase tracking-widest flex-1">Player</span>
                    <button onClick={() => playerFileRefs.current[ch]?.click()}
                      className="text-[8px] px-1.5 py-0.5 rounded font-bold"
                      style={{ background: "rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.5)", border: "1px solid rgba(255,255,255,0.1)" }}>
                      {playerFiles[ch] ? "Change" : "+ File"}
                    </button>
                    <input ref={el => { playerFileRefs.current[ch] = el }} type="file"
                      accept="video/*,image/*"
                      onChange={e => { const f = e.target.files?.[0]; if (f) playerLoad(ch, f) }}
                      className="hidden" />
                  </div>
                  {playerFiles[ch] && (
                    <>
                      {/* Hidden video element for playback */}
                      <video ref={el => { playerRefs.current[ch] = el }}
                        className="hidden"
                        onTimeUpdate={e => setPlayerProgress(prev => ({
                          ...prev, [ch]: ((e.target as HTMLVideoElement).currentTime / ((e.target as HTMLVideoElement).duration || 1)) * 100
                        }))}
                        onEnded={() => setPlayerPlaying(prev => ({ ...prev, [ch]: false }))}
                      />
                      {/* Progress bar */}
                      <div className="h-1 rounded bg-black/60 overflow-hidden cursor-pointer"
                        onClick={e => {
                          const el = playerRefs.current[ch]
                          if (!el) return
                          const rect = e.currentTarget.getBoundingClientRect()
                          el.currentTime = ((e.clientX - rect.left) / rect.width) * (el.duration || 0)
                        }}>
                        <div className="h-full rounded transition-none"
                          style={{ width: `${playerProgress[ch] ?? 0}%`, background: accentColor }} />
                      </div>
                      {/* Controls */}
                      <div className="flex items-center gap-1">
                        <button onClick={() => playerSeek(ch, -5)}
                          className="p-1 rounded text-white/40 hover:text-white"
                          style={{ background: "rgba(255,255,255,0.05)" }}>
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6 8.5 6V6z"/></svg>
                        </button>
                        {playerPlaying[ch]
                          ? <button onClick={() => playerStop(ch)}
                              className="flex-1 py-1 rounded flex items-center justify-center gap-0.5 text-[8px] font-bold"
                              style={{ background: "#ef4444", color: "white" }}>
                              <Square size={8} /> STOP
                            </button>
                          : <button onClick={() => playerPlay(ch)}
                              className="flex-1 py-1 rounded flex items-center justify-center gap-0.5 text-[8px] font-bold"
                              style={{ background: "#22c55e", color: "white" }}>
                              <Play size={8} /> PLAY
                            </button>
                        }
                        <button onClick={() => playerSeek(ch, 5)}
                          className="p-1 rounded text-white/40 hover:text-white"
                          style={{ background: "rgba(255,255,255,0.05)" }}>
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M18 6h-2v12h2zm-3.5 6L6 6v12z"/></svg>
                        </button>
                        <button onClick={() => togglePlayerLoop(ch)}
                          className="p-1 rounded text-[8px] font-bold"
                          title="Loop"
                          style={playerLoop[ch]
                            ? { background: `${accentColor}25`, color: accentColor, border: `1px solid ${accentColor}50` }
                            : { background: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.3)" }}>
                          ↻
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          )
        })}
        </div>
        {/* F1/F2 PREVIEW – tracks selected client's assigned inputs */}
        <div className="flex flex-col gap-2 justify-start">
          <div className="flex items-center gap-1.5 h-5">
            {previewClient ? (
              <>
                <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: previewClient.color || '#71717a' }} />
                <span className="text-[9px] font-bold uppercase tracking-widest truncate max-w-[140px]"
                  style={{ color: previewClient.color || 'rgba(255,255,255,0.5)' }}>
                  {previewClient.name}
                </span>
              </>
            ) : (
              <span className="text-[8px] text-white/20 uppercase tracking-widest">mark a client</span>
            )}
          </div>
          <SlotPreview stream={f1Stream} label={f1Label} color="#ef4444" />
          <SlotPreview stream={f2Stream} label={f2Label} color="#3b82f6" />
        </div>
      </div>

      {/* Custom test pattern creator */}
      <div className="px-4 pb-3 shrink-0" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
        <CustomTestCreator accentColor={accentColor} onSelect={p => {
          // Custom pattern bruges som test på INPUT 1 som default
          setTestMode(prev => ({ ...prev, 1: true }))
          setLabels(prev => ({ ...prev, 1: p.name }))
        }} />
      </div>

      {/* BOTTOM: Routing table */}
      <div className="flex-1 overflow-auto px-4" style={{ paddingTop: 0 }}>
        <table className="w-full text-left border-collapse" style={{ tableLayout: "fixed" }}>
          <thead style={{ position: "sticky", top: 0, zIndex: 10, background: "#18181b" }}>
            <tr>
              <td colSpan={7} style={{ padding: "8px 0 4px 0", background: "#18181b" }}>
                <div className="flex items-center justify-between" style={{ paddingLeft: "8px" }}>
                  <p className="text-[10px] text-white/40 uppercase tracking-widest font-bold">Video routing</p>
                  <div className="flex items-center gap-1.5">
                    {selectedIds.length > 0 && (
                      <button onClick={() => updateMultipleClients(selectedIds, { videoSources: [] })}
                        className="flex items-center gap-1 px-2 py-1 rounded text-[9px] font-bold"
                        style={{ background: "rgba(239,68,68,0.15)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.25)" }}>
                        <Trash2 size={9} /> Clear selected
                      </button>
                    )}
                  </div>
                </div>
              </td>
            </tr>
            <tr style={{ background: "#18181b", borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
              <th className="text-left py-2 text-[10px] text-white/40 font-bold" style={{ background: "#18181b", paddingLeft: "8px" }}>Client</th>
              <th className="py-2 px-2 text-[10px] text-white/30 font-bold w-8" style={{ background: "#18181b" }}>V</th>
              <th className="text-center py-2 px-3 text-[10px] text-white/30 font-bold w-16" style={{ background: "#18181b" }}>OFF</th>
              {[1, 2, 3, 4].map(ch => (
                <th key={ch} className="text-center py-2 px-3 text-[10px] font-bold w-20"
                  style={{ background: "#18181b", color: enabled[ch] && (streams[ch] || testMode[ch]) ? "rgba(255,255,255,0.6)" : "rgba(255,255,255,0.15)" }}>
                  {labels[ch]}
                </th>
              ))}
              <th className="py-2 px-2 text-[9px] text-white/20 font-normal w-24 text-left" style={{ background: "#18181b" }}>max 2 per client</th>
            </tr>
          </thead>
          <tbody>
            {clients.filter(c => !c.hidden).map((c, rowIdx) => {
              const isSelected = selectedIds.includes(c.id)
              const rowBg = rowIdx % 2 === 0 ? "rgba(255,255,255,0.025)" : "rgba(255,255,255,0.005)"
              return (
                <React.Fragment key={c.id}>
                  {[0, 1].map(slot => {
                    const active = getSlot(c, slot)
                    const isRow1 = slot === 0
                    return (
                      <tr key={slot} style={{ background: isRow1 ? rowBg : `${rowBg.replace(")", "").replace("rgba", "rgba")}` }}>
                        {/* Client name – only on first row, spans 2 */}
                        {isRow1 ? (
                          <td rowSpan={2} className="py-2 px-2 cursor-pointer align-middle"
                            onClick={e => onClientMark(c.id, e)}
                            style={{ borderRight: "1px solid rgba(255,255,255,0.06)" }}>
                            <div className="flex items-center gap-2">
                              <div className="w-2 h-2 rounded-full shrink-0" style={{ background: c.color || "#71717a" }} />
                              <span className={`font-bold text-xs ${isSelected ? "text-white" : "text-white/70"}`}>{c.name}</span>
                              {isSelected && (
                                <span className="text-[8px] px-1.5 py-0.5 rounded font-bold"
                                  style={{ background: `${accentColor}25`, color: accentColor }}>✓</span>
                              )}
                            </div>
                          </td>
                        ) : null}

                        {/* Slot label */}
                        <td className="py-1.5 px-2 text-[9px] font-bold text-center"
                          style={{ color: slot === 0 ? '#ef4444' : '#3b82f6', opacity: 0.9, borderRight: "1px solid rgba(255,255,255,0.04)" }}>
                          V{slot + 1}
                        </td>

                        {/* OFF */}
                        <td className="text-center cursor-pointer py-1.5 px-3"
                          onClick={() => setSource(c.id, slot, null)}>
                          <div className="flex items-center justify-center">
                            <div className="w-5 h-5 rounded flex items-center justify-center"
                              style={active === 0
                                ? { background: "rgba(239,68,68,0.2)", border: "1px solid rgba(239,68,68,0.5)" }
                                : { border: "1px solid rgba(255,255,255,0.08)" }}>
                              {active === 0 && <X size={10} className="text-red-400" />}
                            </div>
                          </div>
                        </td>

                        {/* Source 1-4 */}
                        {[1, 2, 3, 4].map(ch => {
                          const isActive = active === ch
                          const hasStream = !!streams[ch] || testMode[ch]
                          return (
                            <td key={ch} className={`text-center py-1.5 px-3 ${hasStream ? 'cursor-pointer' : 'cursor-not-allowed opacity-30'}`}
                              onClick={() => hasStream && setSource(c.id, slot, isActive ? null : ch)}>
                              <div className="flex items-center justify-center">
                                <div className="w-5 h-5 rounded flex items-center justify-center"
                                  style={isActive && hasStream
                                    ? { background: `${accentColor}30`, border: `1px solid ${accentColor}70` }
                                    : { border: "1px solid rgba(255,255,255,0.08)" }}>
                                  {isActive && hasStream && <Check size={10} style={{ color: accentColor }} />}
                                </div>
                              </div>
                            </td>
                          )
                        })}
                      </tr>
                    )
                  })}
                  {/* Separator between clients */}
                  <tr><td colSpan={7} style={{ borderBottom: "1px solid rgba(255,255,255,0.07)", padding: 0 }} /></tr>
                </React.Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default VideoTab
