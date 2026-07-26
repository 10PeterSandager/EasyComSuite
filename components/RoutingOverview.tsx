import { useEffect, useState } from "react"
import { socket } from "../client/webrtc/intercom"
import { Client } from "../types"
import { List, Grid3X3 } from "lucide-react"

type Connection = {
  from: string
  to: string
  channel: number
}

type Props = {
  clients: Client[]
  theme?: "orange" | "blue"
}

const channelColors = [
  "#ef4444","#3b82f6","#22c55e","#a855f7",
  "#f97316","#06b6d4","#eab308","#ec4899"
]

export default function RoutingOverview({ clients, theme = "orange" }: Props) {

  const [connections, setConnections] = useState<Connection[]>([])
  const [view, setView] = useState<"list" | "matrix">("list")

  const themeColor = theme === "orange" ? "orange" : "blue"

  /* ---------- LOAD ---------- */

  useEffect(() => {
    const refresh = (list: Connection[]) => setConnections(list)
    socket.emit("connections:list", refresh)
    socket.on("connections:all", refresh)
    return () => { socket.off("connections:all", refresh) }
  }, [])

  /* ---------- HELPERS ---------- */

  const getName = (id: string) =>
    clients.find(c => c.id === id)?.name ?? id.slice(0, 6)

  const channelColor = (ch: number) =>
    channelColors[(ch - 1) % channelColors.length]

  /* ---------- DISCONNECT ---------- */

  const disconnect = (c: Connection) => {
    socket.emit("connection:remove", c)
  }

  const clearAll = () => {
    connections.forEach(c => socket.emit("connection:remove", { ...c, bidirectional: false }))
  }

  /* ---------- LIST VIEW ---------- */

  const ListView = () => (
    <div className="overflow-auto">
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="text-white/30 border-b border-white/5">
            <th className="text-left py-2 px-3">Fra</th>
            <th className="text-left py-2 px-3">Til</th>
            <th className="text-left py-2 px-3">Kanal</th>
            <th className="py-2 px-3" />
          </tr>
        </thead>
        <tbody>
          {connections.length === 0 && (
            <tr>
              <td colSpan={4} className="text-center py-8 text-white/20">
                Ingen aktive forbindelser
              </td>
            </tr>
          )}
          {connections.map((c, i) => (
            <tr key={i} className="border-b border-white/5 hover:bg-white/5">
              <td className="py-2 px-3 font-bold">{getName(c.from)}</td>
              <td className="py-2 px-3 font-bold">{getName(c.to)}</td>
              <td className="py-2 px-3">
                <span
                  className="px-2 py-0.5 rounded text-[10px] font-bold"
                  style={{
                    background: channelColor(c.channel) + "33",
                    color: channelColor(c.channel)
                  }}
                >
                  CH {c.channel}
                </span>
              </td>
              <td className="py-2 px-3 text-right">
                <button
                  onClick={() => disconnect(c)}
                  className="text-white/20 hover:text-red-400 text-[10px]"
                >
                  ✕
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )

  /* ---------- MATRIX VIEW ---------- */

  const MatrixView = () => {

    const activeIds = Array.from(new Set([
      ...connections.map(c => c.from),
      ...connections.map(c => c.to)
    ]))

    const relevantClients = clients.filter(c => activeIds.includes(c.id))

    if (relevantClients.length === 0) {
      return (
        <div className="flex items-center justify-center py-16 text-white/20 text-sm">
          Ingen aktive forbindelser
        </div>
      )
    }

    return (
      <div className="overflow-auto">
        <table className="text-[10px] border-collapse">
          <thead>
            <tr>
              {/* top-left corner */}
              <th className="w-24 h-24 relative">
                <div className="absolute bottom-2 left-2 text-white/20 text-[9px]">FRA ↓ / TIL →</div>
              </th>
              {relevantClients.map(c => (
                <th key={c.id} className="h-24 w-16 align-bottom pb-2">
                  <div
                    className="whitespace-nowrap origin-bottom-left text-white/60 font-bold"
                    style={{ writingMode: "vertical-rl", transform: "rotate(180deg)", maxHeight: 88 }}
                  >
                    {c.name}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {relevantClients.map(rowClient => (
              <tr key={rowClient.id} className="border-b border-white/5">
                <td className="py-1 pr-3 font-bold text-white/60 whitespace-nowrap border-r border-white/5">
                  {rowClient.name}
                </td>
                {relevantClients.map(colClient => {
                  const conn = connections.find(
                    c => c.from === rowClient.id && c.to === colClient.id
                  )
                  const isSelf = rowClient.id === colClient.id

                  return (
                    <td key={colClient.id} className="w-16 h-8 text-center">
                      {isSelf ? (
                        <div className="w-full h-full bg-white/3 flex items-center justify-center">
                          <span className="text-white/10">—</span>
                        </div>
                      ) : conn ? (
                        <button
                          onClick={() => disconnect(conn)}
                          className="w-8 h-8 mx-auto rounded flex items-center justify-center font-bold hover:opacity-70 transition-opacity"
                          style={{
                            background: channelColor(conn.channel) + "33",
                            color: channelColor(conn.channel),
                            border: `1px solid ${channelColor(conn.channel)}66`
                          }}
                          title={`CH ${conn.channel} – klik for at fjerne`}
                        >
                          {conn.channel}
                        </button>
                      ) : (
                        <div className="w-8 h-8 mx-auto rounded border border-white/5" />
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

  /* ---------- RENDER ---------- */

  return (
    <div className="h-full flex flex-col">

      {/* HEADER */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/5 shrink-0">
        <div>
          <h2 className="text-sm font-bold">Routing oversigt</h2>
          <p className="text-[10px] text-white/30">{connections.length} aktive forbindelser</p>
        </div>
        <div className="flex gap-1 items-center">
          {connections.length > 0 && (
            <button
              onClick={clearAll}
              className="px-2 py-1 rounded text-[9px] font-black text-red-400/70 hover:text-red-400 hover:bg-red-950/30 transition-colors border border-transparent hover:border-red-500/20 mr-1"
              title="Remove all connections"
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

      {/* CONTENT */}
      <div className="flex-1 overflow-auto p-4">
        {view === "list" ? <ListView /> : <MatrixView />}
      </div>

    </div>
  )
}
