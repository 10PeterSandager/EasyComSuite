import React, { useRef, useEffect } from "react"
import { X, Headphones, Volume2, VolumeX } from "lucide-react"

export type IFBChannelSettings = {
  muted: boolean
  duckAmount: number
}

export type IFBSettings = {
  channels: Record<number, IFBChannelSettings>
  active: boolean
}

type Props = {
  settings: IFBSettings
  onChange: (s: IFBSettings) => void
  onClose: () => void
  onActivate: () => void
  onDeactivate: () => void
  clientName: string
  theme?: "orange" | "blue"
}

const MAX_CHANNELS = 16

const channelColors = [
  "#ef4444","#3b82f6","#22c55e","#a855f7",
  "#f97316","#06b6d4","#eab308","#ec4899",
  "#84cc16","#0ea5e9","#f43f5e","#8b5cf6",
  "#10b981","#fb923c","#a78bfa","#34d399",
]

const defaultChannelSettings = (): IFBChannelSettings => ({
  muted: false,
  duckAmount: 70
})

export default function IFBPanel({
  settings, onChange, onClose, onActivate, onDeactivate, clientName, theme = "orange"
}: Props) {

  const panelRef = useRef<HTMLDivElement>(null)
  const accentColor = theme === "orange" ? "#f97316" : "#3b82f6"

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    const t = setTimeout(() => window.addEventListener("mousedown", handler), 100)
    return () => { clearTimeout(t); window.removeEventListener("mousedown", handler) }
  }, [onClose])

  const getChannel = (ch: number): IFBChannelSettings =>
    settings.channels[ch] ?? defaultChannelSettings()

  const updateChannel = (ch: number, updates: Partial<IFBChannelSettings>) => {
    onChange({
      ...settings,
      channels: { ...settings.channels, [ch]: { ...getChannel(ch), ...updates } }
    })
  }

  const setAllDuck = (val: number) => {
    const updated: Record<number, IFBChannelSettings> = {}
    for (let ch = 1; ch <= MAX_CHANNELS; ch++) {
      updated[ch] = { ...getChannel(ch), duckAmount: val }
    }
    onChange({ ...settings, channels: updated })
  }

  const muteAll = () => {
    const updated: Record<number, IFBChannelSettings> = {}
    for (let ch = 1; ch <= MAX_CHANNELS; ch++) {
      updated[ch] = { ...getChannel(ch), muted: true }
    }
    onChange({ ...settings, channels: updated })
  }

  const unmuteAll = () => {
    const updated: Record<number, IFBChannelSettings> = {}
    for (let ch = 1; ch <= MAX_CHANNELS; ch++) {
      updated[ch] = { ...getChannel(ch), muted: false }
    }
    onChange({ ...settings, channels: updated })
  }

  return (
    <div
      ref={panelRef}
      // 🔥 Opens DOWNWARD from the button, not upward
      className="absolute top-full left-0 mt-1 z-50 rounded-2xl overflow-hidden shadow-2xl"
      style={{
        width: 300,
        // 🔥 Max height with scroll so it never goes off-screen
        maxHeight: "min(420px, calc(100vh - 200px))",
        display: "flex",
        flexDirection: "column",
        background: "linear-gradient(160deg, #1c1c1e 0%, #111 100%)",
        border: "1px solid rgba(255,255,255,0.08)",
        boxShadow: "0 24px 48px rgba(0,0,0,0.9), inset 0 1px 0 rgba(255,255,255,0.06)"
      }}
    >

      {/* HEADER – fixed */}
      <div
        className="flex items-center justify-between px-4 py-3 shrink-0"
        style={{
          background: `linear-gradient(90deg, ${accentColor}20, transparent)`,
          borderBottom: "1px solid rgba(255,255,255,0.06)"
        }}
      >
        <div className="flex items-center gap-2">
          <Headphones size={13} style={{ color: accentColor }} />
          <div>
            <div className="text-[9px] text-white/30 font-mono uppercase tracking-widest">IFB</div>
            <div className="text-xs font-bold text-white">{clientName}</div>
          </div>
        </div>
        <button onClick={onClose} className="p-1 rounded hover:bg-white/10 text-white/30 hover:text-white">
          <X size={13} />
        </button>
      </div>

      {/* SCROLLABLE CONTENT */}
      <div className="overflow-auto flex-1 p-4 space-y-4">

        {/* ACTIVATE TOGGLE */}
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-bold text-white">IFB Aktiv</p>
            <p className="text-[9px] text-white/30">Hold IFB aktivt</p>
          </div>
          <button
            onClick={() => settings.active ? onDeactivate() : onActivate()}
            className="relative w-10 h-5 rounded-full transition-all"
            style={{
              background: settings.active ? accentColor : "rgba(255,255,255,0.1)",
              boxShadow: settings.active ? `0 0 10px ${accentColor}60` : "none"
            }}
          >
            <div
              className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all"
              style={{ left: settings.active ? "22px" : "2px" }}
            />
          </button>
        </div>

        {/* BULK CONTROLS */}
        <div className="space-y-2">
          <p className="text-[8px] text-white/30 uppercase tracking-widest">Duck alle kanaler</p>
          <input
            type="range" min={0} max={100} defaultValue={70}
            onChange={e => setAllDuck(Number(e.target.value))}
            className="w-full h-1 appearance-none cursor-pointer rounded"
            style={{ accentColor }}
          />
          <div className="flex gap-2">
            <button onClick={muteAll}
              className="flex-1 py-1 rounded text-[8px] font-bold flex items-center justify-center gap-1 hover:bg-red-600/20 text-white/40 hover:text-red-400"
              style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}>
              <VolumeX size={9} /> Mute alle
            </button>
            <button onClick={unmuteAll}
              className="flex-1 py-1 rounded text-[8px] font-bold flex items-center justify-center gap-1 hover:bg-green-600/20 text-white/40 hover:text-green-400"
              style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}>
              <Volume2 size={9} /> Unmute alle
            </button>
          </div>
        </div>

        {/* CHANNEL ROWS */}
        <div className="space-y-2">
          <p className="text-[8px] text-white/30 uppercase tracking-widest">Kanaler</p>
          {Array.from({ length: MAX_CHANNELS }, (_, i) => {
            const ch = i + 1
            const chSettings = getChannel(ch)
            const color = channelColors[i % channelColors.length]

            return (
              <div key={ch}
                className="flex items-center gap-2 px-3 py-2 rounded-xl"
                style={{
                  background: chSettings.muted ? "rgba(239,68,68,0.08)" : "rgba(255,255,255,0.03)",
                  border: `1px solid ${chSettings.muted ? "#ef444430" : "rgba(255,255,255,0.05)"}`
                }}
              >
                <div
                  className="w-5 h-5 rounded-md flex items-center justify-center text-[8px] font-bold shrink-0"
                  style={{
                    background: chSettings.muted ? "rgba(239,68,68,0.2)" : color + "25",
                    color: chSettings.muted ? "#ef4444" : color,
                    border: `1px solid ${chSettings.muted ? "#ef444450" : color + "50"}`
                  }}
                >
                  {ch}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex justify-between mb-1">
                    <span className="text-[8px] text-white/30">Duck</span>
                    <span className="text-[8px] font-mono" style={{ color: chSettings.muted ? "#ef4444" : color }}>
                      {chSettings.muted ? "MUTE" : `${chSettings.duckAmount}%`}
                    </span>
                  </div>
                  <input
                    type="range" min={0} max={100} value={chSettings.duckAmount}
                    disabled={chSettings.muted}
                    onChange={e => updateChannel(ch, { duckAmount: Number(e.target.value) })}
                    className="w-full h-1 appearance-none cursor-pointer rounded"
                    style={{ accentColor: color, opacity: chSettings.muted ? 0.3 : 1 }}
                  />
                  <div className="mt-1 h-1 bg-white/5 rounded overflow-hidden">
                    <div className="h-full rounded transition-all"
                      style={{
                        width: chSettings.muted ? "100%" : `${chSettings.duckAmount}%`,
                        background: chSettings.muted ? "#ef4444" : `linear-gradient(90deg, ${color}60, ${color})`
                      }}
                    />
                  </div>
                </div>

                <button
                  onClick={() => updateChannel(ch, { muted: !chSettings.muted })}
                  className="p-1.5 rounded-lg transition-all shrink-0"
                  style={chSettings.muted ? {
                    background: "#ef444420", border: "1px solid #ef444450", color: "#ef4444"
                  } : {
                    background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.3)"
                  }}
                >
                  {chSettings.muted ? <VolumeX size={11} /> : <Volume2 size={11} />}
                </button>
              </div>
            )
          })}
        </div>

      </div>

    </div>
  )
}
