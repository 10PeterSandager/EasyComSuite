type BusType =
  | "talk"
  | "ifb"
  | "program"
  | "aux"

interface AudioBus {

  id: string
  type: BusType
  listeners: Set<string>
  sources: Set<string>

}

const buses = new Map<string, AudioBus>()

export function createBus(id: string, type: BusType) {

  buses.set(id, {
    id,
    type,
    listeners: new Set(),
    sources: new Set()
  })

}

export function subscribe(busId: string, clientId: string) {

  const bus = buses.get(busId)

  if (!bus) return

  bus.listeners.add(clientId)

}

export function publish(busId: string, clientId: string) {

  const bus = buses.get(busId)

  if (!bus) return

  bus.sources.add(clientId)

}

export function unsubscribe(busId: string, clientId: string) {

  const bus = buses.get(busId)

  if (!bus) return

  bus.listeners.delete(clientId)
  bus.sources.delete(clientId)

}

export function getListeners(busId: string) {

  const bus = buses.get(busId)

  if (!bus) return []

  return Array.from(bus.listeners)

}