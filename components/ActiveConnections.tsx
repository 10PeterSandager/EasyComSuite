
import { useEffect, useState } from "react"
import { socket } from "../client/webrtc/intercom"

type Connection = {
  from: string
  to: string
  channel: number
}

export default function ActiveConnections() {

  const [connections, setConnections] = useState<Connection[]>([])

  useEffect(() => {

    socket.emit("connections:list", (list: Connection[]) => {
      setConnections(list)
    })

    socket.on("routing:update", () => {
      socket.emit("connections:list", (list: Connection[]) => {
        setConnections(list)
      })
    })

    return () => {
      socket.off("routing:update")
    }

  }, [])

  function disconnect(conn: Connection) {

    socket.emit("connection:remove", conn)

  }

  return (

    <div className="p-4 space-y-2">

      <h3 className="text-xs font-bold text-zinc-400 uppercase">
        Active Connections
      </h3>

      {connections.map((c, i) => (

        <div
          key={i}
          className="flex justify-between items-center bg-zinc-800 px-3 py-2 rounded text-xs"
        >

          <span>
            {c.from} → {c.to} (CH {c.channel})
          </span>

          <button
            onClick={() => disconnect(c)}
            className="text-red-400 hover:text-red-300"
          >
            Disconnect
          </button>

        </div>

      ))}

      {connections.length === 0 && (
        <div className="text-xs text-zinc-600">
          No active connections
        </div>
      )}

    </div>

  )

}