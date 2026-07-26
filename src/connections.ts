type Connection = {
  from: string
  to: string
  channel: number
}

const connections: Connection[] = []

export function addConnection(conn: Connection) {

  const exists = connections.find(c =>
    c.from === conn.from &&
    c.to === conn.to &&
    c.channel === conn.channel
  )

  if (exists) return

  connections.push(conn)
}

export function removeConnection(conn: Connection) {
  const index = connections.findIndex(c =>
    c.from === conn.from &&
    c.to === conn.to &&
    c.channel === conn.channel
  )

  if (index !== -1) connections.splice(index, 1)
}

export function getConnections() {
  return connections
}

export function getConnectionsForTarget(clientId: string) {
  return connections.filter(c => c.to === clientId)
}