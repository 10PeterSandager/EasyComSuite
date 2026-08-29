import { useEffect, useRef, useState } from "react"
import { socket } from "../client/webrtc/intercom"
import { Client } from "../types"
import { List, Grid3X3, Search, X } from "lucide-react"

type Connection = {
  from: string
  to: string
  channel: number
  toChannel?: number
}

type CtxMenu = {
  x: number
  y: number
  rowClient: Client
  colClient: Client
  conn: Connection | null
}

type Props = {
  clients: Client[]
  theme?: "orange" | "blue"
}

const channelColors = [
  "#ef4444","#3b82f6","#22c55e","#a855f7",
  "#f97316","#06b6d4","#eab308","#ec4899",
]

export default function RoutingOverview({ clients, theme = "orange" }: Props) {

  const [connections, setConnections] = useState<Connection[]>([])
  const [view, setView]               = useState<"list" | "matrix">("list")
  const [ctxMenu, setCtxMenu]         = useState<CtxMenu | null>(null)
  const [filterId, setFilterId]       = useState("")
  const [searchText, setSearchText]   = useState("")
  const menuRef = useRef<HTMLDivElement>(null)

  const themeColor = theme === "orange" ? "orange" : "blue"

  /* ── data ── */

  useEffect(() => {
    const refresh = (list: Connection[]) => setConnections(Array.isArray(list) ? list : [])
    socket.emit("connections:list", refresh)
    socket.on("connections:all", refresh)
    return () => { socket.off("connections:all", refresh) }
  }, [])

  /* ── close context menu on outside mousedown ── */

  useEffect(() => {
    if (!ctxMenu) return
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node))
        setCtxMenu(null)
    }
    window.addEventListener("mousedown", handler)
    return () => window.removeEventListener("mousedown", handler)
  }, [ctxMenu])

  /* ── helpers ── */

  const getName = (id: string) =>
    clients.find(c => c.id === id)?.name ?? id.slice(0, 8)

  const chColor = (ch: number) => channelColors[(ch - 1) % channelColors.length]

  const removeConn = (c: Connection) => {
    socket.emit("connection:remove", { ...c, bidirectional: false })
    setCtxMenu(null)
  }

  const createConn = (from: string, to: string, ch: number) => {
    socket.emit("connection:create", { from, to, channel: ch, bidirectional: false })
    setCtxMenu(null)
  }

  const clearAll = () =>
    connections.forEach(c => socket.emit("connection:remove", { ...c, bidirectional: false }))

  /* ── filtered list ── */

  const filtered = connections.filter(c => {
    if (filterId && c.from !== filterId && c.to !== filterId) return false
    if (searchText) {
      const q = searchText.toLowerCase()
      if (!getName(c.from).toLowerCase().includes(q) &&
          !getName(c.to).toLowerCase().includes(q)) return false
    }
    return true
  })

  /* ── LIST VIEW — called as a function, not <ListView />, to avoid remount issues ── */

  const renderList = () => (
    <div>
      {/* search bar */}
      <div className="flex gap-2 mb-4">
        <div className="relative flex-1">
          <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-white/30 pointer-events-none" />
          <input
            value={searchText}
            onChange={e => setSearchText(e.target.value)}
            placeholder="Search…"
            className="w-full pl-7 pr-2 py-1.5 rounded text-[11px] bg-white/5 border border-white/10 text-white placeholder-white/25 outline-none focus:border-white/20 transition-colors"
          />
        </div>
        <select
          value={filterId}
          onChange={e => setFilterId(e.target.value)}
          className="px-2 py-1.5 rounded text-[11px] bg-white/5 border border-white/10 text-white outline-none cursor-pointer"
          style={{ maxWidth: 150 }}
        >
          <option value="">All clients</option>
          {clients.map(c => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        {(filterId || searchText) && (
          <button
            onClick={() => { setFilterId(""); setSearchText("") }}
            className="px-2 rounded text-white/40 hover:text-white bg-white/5 border border-white/10 transition-colors"
            title="Clear filter"
          >
            <X size={12} />
          </button>
        )}
      </div>

      {/* table */}
      <div className="overflow-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="text-white/30 border-b border-white/5 text-[10px] uppercase tracking-wider">
              <th className="text-left py-2 px-3 font-semibold">From</th>
              <th className="text-left py-2 px-3 font-semibold">To</th>
              <th className="text-left py-2 px-3 font-semibold">Channel</th>
              <th className="py-2 px-3" />
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={4} className="text-center py-10 text-white/20 text-xs">
                  {filterId || searchText ? "No matching connections" : "No active connections"}
                </td>
              </tr>
            )}
            {filtered.map((c, i) => (
              <tr key={i} className="border-b border-white/5 hover:bg-white/4 group">
                <td className="py-2 px-3 font-bold text-white/80">{getName(c.from)}</td>
                <td className="py-2 px-3 font-bold text-white/80">{getName(c.to)}</td>
                <td className="py-2 px-3">
                  <span
                    className="px-2 py-0.5 rounded text-[10px] font-bold"
                    style={{ background: chColor(c.channel) + "33", color: chColor(c.channel) }}
                  >
                    CH {c.channel}
                  </span>
                  {c.toChannel != null && (
                    <span className="ml-1.5 text-white/30 text-[9px]">TB{c.toChannel}</span>
                  )}
                </td>
                <td className="py-2 px-3 text-right">
                  <button
                    onClick={() => removeConn(c)}
                    className="text-white/15 hover:text-red-400 transition-colors text-[11px] opacity-0 group-hover:opacity-100"
                    title="Remove connection"
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )

  /* ── MATRIX VIEW — called as a function ── */

  const renderMatrix = () => {
    const activeIds = Array.from(new Set([
      ...connections.map(c => c.from),
      ...connections.map(c => c.to),
    ]))
    const cols = clients.filter(c => activeIds.includes(c.id))

    if (cols.length === 0) {
      return (
        <div className="flex items-center justify-center py-16 text-white/20 text-sm">
          No active connections
        </div>
      )
    }

    const COL_W   = 52
    const LABEL_W = 128
    const HDR_H   = 100

    const onCtx = (
      e: React.MouseEvent,
      row: Client,
      col: Client,
      conn: Connection | null
    ) => {
      e.preventDefault()
      const mh = conn ? 80 : 130
      const x = Math.min(e.clientX, window.innerWidth  - 210)
      const y = Math.min(e.clientY, window.innerHeight - mh - 8)
      setCtxMenu({ x, y, rowClient: row, colClient: col, conn })
    }

    return (
      <div className="overflow-auto">
        <table
          className="text-[10px] border-collapse"
          style={{ tableLayout: "fixed", borderSpacing: 0 }}
        >
          <colgroup>
            <col style={{ width: LABEL_W }} />
            {cols.map(c => <col key={c.id} style={{ width: COL_W }} />)}
          </colgroup>
          <thead>
            <tr>
              {/* corner */}
              <th
                className="relative border-r border-b border-white/8 select-none"
                style={{ width: LABEL_W, height: HDR_H }}
              >
                <svg
                  className="absolute inset-0 w-full h-full pointer-events-none"
                  viewBox={`0 0 ${LABEL_W} ${HDR_H}`}
                  preserveAspectRatio="none"
                >
                  <line x1="0" y1="0" x2={LABEL_W} y2={HDR_H}
                    stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
                </svg>
                <span className="absolute top-2 right-2 text-white/25"
                  style={{ fontSize: 9, letterSpacing: "0.04em" }}>TO →</span>
                <span className="absolute bottom-2 left-2 text-white/25"
                  style={{ fontSize: 9, letterSpacing: "0.04em" }}>FROM ↓</span>
              </th>

              {/* column headers */}
              {cols.map(c => (
                <th key={c.id} className="border-r border-b border-white/8 align-bottom"
                  style={{ width: COL_W, height: HDR_H, paddingBottom: 6 }}>
                  <div className="text-white/55 font-semibold overflow-hidden mx-auto"
                    style={{
                      writingMode: "vertical-rl",
                      transform: "rotate(180deg)",
                      maxHeight: HDR_H - 12,
                      fontSize: 10, lineHeight: 1.2,
                      width: "fit-content",
                    }}>
                    {c.name}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {cols.map(row => (
              <tr key={row.id} className="border-b border-white/5">
                <td className="py-1.5 pl-3 pr-2 font-semibold text-white/55 whitespace-nowrap border-r border-white/8"
                  style={{ fontSize: 11, width: LABEL_W }}>
                  {row.name}
                </td>
                {cols.map(col => {
                  const conn = connections.find(
                    c => c.from === row.id && c.to === col.id
                  )
                  const isSelf = row.id === col.id
                  return (
                    <td key={col.id} className="text-center border-r border-white/5"
                      style={{ width: COL_W, height: 36 }}
                      onContextMenu={isSelf ? undefined : e => onCtx(e, row, col, conn ?? null)}
                    >
                      {isSelf ? (
                        <div className="w-full h-full flex items-center justify-center">
                          <span className="text-white/8 text-[10px]">╲</span>
                        </div>
                      ) : conn ? (
                        <button
                          onClick={() => removeConn(conn)}
                          onContextMenu={e => onCtx(e, row, col, conn)}
                          className="w-8 h-8 mx-auto flex items-center justify-center font-bold rounded transition-opacity hover:opacity-70"
                          style={{
                            background: chColor(conn.channel) + "33",
                            color: chColor(conn.channel),
                            border: `1px solid ${chColor(conn.channel)}66`,
                            fontSize: 11,
                          }}
                          title="Click to remove — right-click for options"
                        >
                          {conn.channel}
                        </button>
                      ) : (
                        <div
                          className="w-8 h-8 mx-auto rounded border border-white/5 hover:border-white/20 hover:bg-white/3 transition-all cursor-context-menu"
                          title="Right-click to create connection"
                        />
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  /* ── RENDER ── */

  return (
    <div className="h-full flex flex-col">

      {/* header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/5 shrink-0">
        <div>
          <h2 className="text-sm font-bold">Routing overview</h2>
          <p className="text-[10px] text-white/30">{connections.length} active connections</p>
        </div>
        <div className="flex gap-1 items-center">
          {connections.length > 0 && (
            <button
              onClick={clearAll}
              className="px-2 py-1 rounded text-[9px] font-black text-red-400/60 hover:text-red-400 hover:bg-red-950/30 transition-colors border border-transparent hover:border-red-500/20 mr-1"
            >
              Clear all
            </button>
          )}
          <button
            onClick={() => setView("list")}
            className={`p-2 rounded ${view === "list" ? `bg-${themeColor}-600` : "bg-white/5 hover:bg-white/10"}`}
          >
            <List size={14} />
          </button>
          <button
            onClick={() => setView("matrix")}
            className={`p-2 rounded ${view === "matrix" ? `bg-${themeColor}-600` : "bg-white/5 hover:bg-white/10"}`}
          >
            <Grid3X3 size={14} />
          </button>
        </div>
      </div>

      {/* content — render functions called directly, not as JSX components */}
      <div className="flex-1 overflow-auto p-4">
        {view === "list" ? renderList() : renderMatrix()}
      </div>

      {/* context menu — inlined JSX so it's never remounted on parent re-renders */}
      {ctxMenu && (
        <div
          ref={menuRef}
          className="fixed z-50 rounded-xl shadow-2xl overflow-hidden"
          style={{
            left: ctxMenu.x,
            top: ctxMenu.y,
            background: "#1c1c1e",
            border: "1px solid rgba(255,255,255,0.1)",
            minWidth: 190,
            boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
          }}
          onContextMenu={e => e.preventDefault()}
        >
          {/* header */}
          <div className="px-3 py-2 border-b border-white/8">
            <div className="text-[10px] text-white/40 font-semibold uppercase tracking-wider">
              {ctxMenu.conn ? "Connection" : "New connection"}
            </div>
            <div className="text-xs text-white/70 font-bold mt-0.5">
              {ctxMenu.rowClient.name} → {ctxMenu.colClient.name}
            </div>
          </div>

          {ctxMenu.conn ? (
            /* remove */
            <button
              onClick={() => removeConn(ctxMenu.conn!)}
              className="w-full text-left px-3 py-2.5 text-xs flex items-center gap-2 text-red-400 hover:bg-red-500/10 transition-colors"
            >
              <span className="text-[11px]">✕</span>
              Remove CH {ctxMenu.conn.channel}
            </button>
          ) : (
            /* create — pick channel */
            <div className="p-3 space-y-2">
              <div className="text-[10px] text-white/35">Select channel:</div>
              <div className="grid grid-cols-4 gap-1.5">
                {[1, 2, 3, 4, 5, 6, 7, 8].map(ch => (
                  <button
                    key={ch}
                    onClick={() => createConn(ctxMenu.rowClient.id, ctxMenu.colClient.id, ch)}
                    className="h-7 rounded text-[10px] font-bold flex items-center justify-center transition-opacity hover:opacity-75"
                    style={{
                      background: chColor(ch) + "33",
                      color: chColor(ch),
                      border: `1px solid ${chColor(ch)}55`,
                    }}
                  >
                    {ch}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
