import { useState, useEffect, useRef } from "react"
import { socket } from "../client/webrtc/intercom"
import { Client } from "../types"

type DragState = {
  fromId: string
  x: number
  y: number
}

type Props = {
  clients: Client[]
}

export default function DragConnectionLayer({ clients }: Props) {

  const [drag, setDrag] = useState<DragState | null>(null)
  const [channel, setChannel] = useState(1)
  const [hoveredId, setHoveredId] = useState<string | null>(null)

  const dragRef = useRef<DragState | null>(null)
  const channelRef = useRef(1)
  const hoveredRef = useRef<string | null>(null)
  const isDraggingRef = useRef(false) // 🔥 explicit drag guard

  const syncDrag = (d: DragState | null) => {
    dragRef.current = d
    isDraggingRef.current = d !== null
    setDrag(d)
  }

  const syncChannel = (c: number) => {
    channelRef.current = c
    setChannel(c)
  }

  const syncHovered = (id: string | null) => {
    hoveredRef.current = id
    setHoveredId(id)
  }

  const cleanup = () => {
    document.body.style.userSelect = ""
    syncDrag(null)
    syncHovered(null)
  }

  /* 🔥 ALWAYS RESET ON MOUNT – prevents stale state from hot-reload */
  useEffect(() => {
    cleanup()
  }, [])

  /* ---------------- START DRAG ---------------- */

  useEffect(() => {

    function handleMouseDown(e: MouseEvent) {
      if (!e.shiftKey) return

      const el = (e.target as HTMLElement).closest("[data-client-id]")
      if (!el) return

      const id = el.getAttribute("data-client-id")
      if (!id) return

      e.preventDefault()
      e.stopPropagation()

      document.body.style.userSelect = "none"
      syncHovered(null)
      syncDrag({ fromId: id, x: e.clientX, y: e.clientY })
    }

    window.addEventListener("mousedown", handleMouseDown, true)
    return () => window.removeEventListener("mousedown", handleMouseDown, true)

  }, [])

  /* ---------------- MOVE ---------------- */

  useEffect(() => {

    function move(e: MouseEvent) {
      if (!isDraggingRef.current) return

      syncDrag({ ...dragRef.current!, x: e.clientX, y: e.clientY })

      const svgEl = document.getElementById("drag-connection-svg")
      if (svgEl) svgEl.style.pointerEvents = "none"
      const el = document.elementFromPoint(e.clientX, e.clientY)
      if (svgEl) svgEl.style.pointerEvents = ""

      const clientEl = el?.closest("[data-client-id]") as HTMLElement | null
      const id = clientEl?.getAttribute("data-client-id") ?? null

      syncHovered(id && id !== dragRef.current?.fromId ? id : null)
    }

    window.addEventListener("mousemove", move)
    return () => window.removeEventListener("mousemove", move)

  }, [])

  /* ---------------- END DRAG ---------------- */

  useEffect(() => {

    function up(e: MouseEvent) {
      if (!isDraggingRef.current) return // 🔥 only act if we were actually dragging

      const currentDrag = dragRef.current
      const currentHovered = hoveredRef.current
      const currentChannel = channelRef.current

      if (currentDrag && currentHovered) {
        socket.emit("connection:create", {
          from: currentDrag.fromId,
          to: currentHovered,
          channel: currentChannel
        })
      }

      cleanup()
    }

    // 🔥 Also clean up on window blur (e.g. user tabs away mid-drag)
    function blur() {
      if (isDraggingRef.current) cleanup()
    }

    window.addEventListener("mouseup", up)
    window.addEventListener("blur", blur)
    return () => {
      window.removeEventListener("mouseup", up)
      window.removeEventListener("blur", blur)
    }

  }, [])

  /* ---------------- ESC CANCEL ---------------- */

  useEffect(() => {

    function esc(e: KeyboardEvent) {
      if (e.key === "Escape" && isDraggingRef.current) cleanup()
    }

    window.addEventListener("keydown", esc)
    return () => window.removeEventListener("keydown", esc)

  }, [])

  /* ---------------- GET CENTER ---------------- */

  function getCenter(id: string) {
    const el = document.querySelector(`[data-client-id="${id}"]`) as HTMLElement | null
    if (!el) return null
    const rect = el.getBoundingClientRect()
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
  }

  /* ---------------- RENDER ---------------- */

  if (!drag || !isDraggingRef.current) return null

  const from = getCenter(drag.fromId)
  if (!from) return null

  const midX = (from.x + drag.x) / 2
  const midY = (from.y + drag.y) / 2

  return (
    <svg
      id="drag-connection-svg"
      className="fixed inset-0 w-full h-full pointer-events-none z-50"
    >

      <path
        d={`M ${from.x} ${from.y} Q ${midX} ${midY - 40} ${drag.x} ${drag.y}`}
        stroke={hoveredId ? "#22c55e" : "rgba(249,115,22,0.8)"}
        strokeWidth={hoveredId ? 3 : 2}
        strokeDasharray={hoveredId ? "0" : "6 4"}
        fill="none"
      />

      <circle cx={from.x} cy={from.y} r="5" fill="#f97316" opacity="0.8" />

      <circle
        cx={drag.x}
        cy={drag.y}
        r={hoveredId ? 8 : 5}
        fill={hoveredId ? "#22c55e" : "#f97316"}
      />

      {hoveredId && (() => {
        const center = getCenter(hoveredId)
        if (!center) return null
        return (
          <circle
            cx={center.x}
            cy={center.y}
            r="30"
            fill="none"
            stroke="#22c55e"
            strokeWidth="2"
            opacity="0.8"
          />
        )
      })()}

      <foreignObject x={drag.x + 12} y={drag.y + 12} width="120" height="60">
        <div className="bg-black/90 border border-white/10 rounded-lg p-2 text-white text-xs pointer-events-auto shadow-xl">
          <div className="mb-1 text-white/40">Kanal</div>
          <select
            value={channel}
            onChange={e => syncChannel(Number(e.target.value))}
            className="w-full bg-zinc-900 border border-white/10 rounded px-1 py-0.5 text-white"
          >
            {Array.from({ length: 8 }).map((_, i) => (
              <option key={i} value={i + 1}>{i + 1}</option>
            ))}
          </select>
        </div>
      </foreignObject>

    </svg>
  )
}
