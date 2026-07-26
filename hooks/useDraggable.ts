import { useRef, useState, useCallback } from "react"

type Position = { x: number; y: number }

export function useDraggable(initialPos?: Partial<Position>) {
  const [pos, setPos] = useState<Position>({
    x: initialPos?.x ?? window.innerWidth / 2 - 240,
    y: initialPos?.y ?? window.innerHeight / 2 - 300
  })
  const dragging = useRef(false)
  const offset = useRef<Position>({ x: 0, y: 0 })

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    // Only drag on the handle element itself
    dragging.current = true
    offset.current = { x: e.clientX - pos.x, y: e.clientY - pos.y }

    const onMove = (ev: MouseEvent) => {
      if (!dragging.current) return
      setPos({
        x: Math.max(0, Math.min(window.innerWidth - 100, ev.clientX - offset.current.x)),
        y: Math.max(0, Math.min(window.innerHeight - 100, ev.clientY - offset.current.y))
      })
    }

    const onUp = () => {
      dragging.current = false
      window.removeEventListener("mousemove", onMove)
      window.removeEventListener("mouseup", onUp)
    }

    window.addEventListener("mousemove", onMove)
    window.addEventListener("mouseup", onUp)
    e.preventDefault()
  }, [pos])

  return { pos, onMouseDown }
}
