import { useEffect, useState, useRef } from "react"
import { socket, getAudioLevel } from "../client/webrtc/intercom"
import { Client } from "../types"

type Connection = {
  from: string
  to: string
  channel: number
}

type Props = {
  clients: Client[]
}

const channelColors = [
  "#ef4444","#3b82f6","#22c55e","#a855f7",
  "#f97316","#06b6d4","#eab308","#ec4899"
]

export default function RoutingGraph({ clients }: Props) {

  const [connections, setConnections] = useState<Connection[]>([])
  const [tick, setTick] = useState(0)
  const [hoveredClient, setHoveredClient] = useState<string | null>(null)
  const [focusedClient, setFocusedClient] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const rafRef = useRef<number | null>(null)
  const readyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 🔥 Set of client IDs that are actually in this graph
  const clientIds = new Set(clients.map(c => c.id))

  /* ---------- LOAD ---------- */

  useEffect(() => {
    const load = (list?: Connection[]) => {
      if (Array.isArray(list)) { setConnections(list); return }
      socket.emit("connections:list", (res: Connection[]) => {
        setConnections(Array.isArray(res) ? res : [])
      })
    }
    load()
    socket.on("routing:update", load)
    return () => { socket.off("routing:update", load) }
  }, [])

  /* ---------- WAIT FOR DOM ---------- */

  useEffect(() => {
    setReady(false)
    if (clients.length === 0) return

    if (readyTimerRef.current) clearTimeout(readyTimerRef.current)

    const check = () => {
      const allPresent = clients.every(c => {
        const el = document.getElementById(`client-${c.id}`)
        if (!el) return false
        const rect = el.getBoundingClientRect()
        return rect.width > 0 && rect.height > 0
      })
      if (allPresent) {
        setReady(true)
      } else {
        readyTimerRef.current = setTimeout(check, 120)
      }
    }

    readyTimerRef.current = setTimeout(check, 200)
    return () => { if (readyTimerRef.current) clearTimeout(readyTimerRef.current) }
  }, [clients])

  /* ---------- RAF LOOP ---------- */

  useEffect(() => {
    // 🔥 Filter to only connections between visible clients
    const visibleConnections = connections.filter(
      c => clientIds.has(c.from) && clientIds.has(c.to)
    )

    if (!ready || visibleConnections.length === 0) {
      if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null }
      return
    }

    const loop = () => {
      setTick(t => t + 1)
      rafRef.current = requestAnimationFrame(loop)
    }
    rafRef.current = requestAnimationFrame(loop)
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }
  }, [ready, connections.length, clients.length])

  /* ---------- HOVER ---------- */

  useEffect(() => {
    const handlers: { el: HTMLElement; enter: () => void; leave: () => void; click: () => void }[] = []
    clients.forEach(c => {
      const el = document.getElementById(`client-${c.id}`)
      if (!el) return
      const enter = () => setHoveredClient(c.id)
      const leave = () => setHoveredClient(null)
      const click = () => setFocusedClient(prev => prev === c.id ? null : c.id)
      el.addEventListener("mouseenter", enter)
      el.addEventListener("mouseleave", leave)
      el.addEventListener("click", click)
      handlers.push({ el, enter, leave, click })
    })
    return () => {
      handlers.forEach(({ el, enter, leave, click }) => {
        el.removeEventListener("mouseenter", enter)
        el.removeEventListener("mouseleave", leave)
        el.removeEventListener("click", click)
      })
    }
  }, [clients])

  /* ---------- GET CENTER ---------- */

  function getCenter(id: string) {
    const el = document.getElementById(`client-${id}`)
    if (!el) return null
    const rect = el.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0 || (rect.x === 0 && rect.y === 0)) return null
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
  }

  function isVisible(c: Connection) {
    if (focusedClient) return c.from === focusedClient || c.to === focusedClient
    if (hoveredClient) return c.from === hoveredClient || c.to === hoveredClient
    return true
  }

  function disconnect(c: Connection) {
    socket.emit("connection:remove", c)
  }

  /* ---------- RENDER ---------- */

  // 🔥 Only connections where BOTH endpoints are in our client list
  const visibleConnections = connections.filter(
    c => clientIds.has(c.from) && clientIds.has(c.to)
  )

  if (!ready || visibleConnections.length === 0) return null

  return (
    <svg className="fixed inset-0 w-full h-full pointer-events-none z-20">
      {visibleConnections.map((c) => {
        if (!isVisible(c)) return null

        const from = getCenter(c.from)
        const to = getCenter(c.to)

        if (!from || !to) return null
        // 🔥 Skip if coords are suspiciously identical or zero
        if (Math.abs(from.x - to.x) < 2 && Math.abs(from.y - to.y) < 2) return null

        const level = getAudioLevel(c.from)
        const midX = (from.x + to.x) / 2
        const midY = (from.y + to.y) / 2
        const cy = midY - 50
        const color = channelColors[(c.channel - 1) % channelColors.length]
        const isHighlighted = hoveredClient && (c.from === hoveredClient || c.to === hoveredClient)
        const opacity = isHighlighted ? 1 : 0.25 + level / 120
        const width = isHighlighted ? 4 : 2 + level / 40

        return (
          <g key={`${c.from}-${c.to}-${c.channel}`}>
            <path
              d={`M ${from.x} ${from.y} Q ${midX} ${cy} ${to.x} ${to.y}`}
              stroke={color} strokeWidth={width} opacity={opacity} fill="none"
            />
            <path
              d={`M ${from.x} ${from.y} Q ${midX} ${cy} ${to.x} ${to.y}`}
              stroke="transparent" strokeWidth={16} fill="none"
              style={{ pointerEvents: "all", cursor: "pointer" }}
              onClick={() => disconnect(c)}
            />
            <g transform={`translate(${midX}, ${midY})`}>
              <rect width={22} height={14} x={-11} y={-7} rx={4} fill="black" />
              <text textAnchor="middle" y={4} fontSize="9" fill={color}>{c.channel}</text>
            </g>
            {level > 10 && (
              <circle r="3" fill={color}>
                <animateMotion
                  dur={`${Math.max(0.5, 1.8 - level / 60)}s`}
                  repeatCount="indefinite"
                  path={`M ${from.x} ${from.y} Q ${midX} ${cy} ${to.x} ${to.y}`}
                />
              </circle>
            )}
          </g>
        )
      })}
    </svg>
  )
}
