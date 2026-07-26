import { getConnectionsForTarget } from "./connections"

type RoutingMap = {
  [channel: number]: string[]
}

export function buildRoutingForClient(clientId: string): RoutingMap {

  const connections = getConnectionsForTarget(clientId)

  const map: RoutingMap = {}

  for (const conn of connections) {

    if (!map[conn.channel]) {
      map[conn.channel] = []
    }

    map[conn.channel].push(conn.from)
  }

  return map
}
