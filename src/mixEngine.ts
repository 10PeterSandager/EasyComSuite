interface MixBus {

  id: string
  sources: Set<string>
  listeners: Set<string>

}

const buses = new Map<string, MixBus>()

export function createMixBus(id: string) {

  buses.set(id, {
    id,
    sources: new Set(),
    listeners: new Set()
  })

}

export function addSource(busId: string, clientId: string) {

  const bus = buses.get(busId)

  if (!bus) return

  bus.sources.add(clientId)

}

export function addListener(busId: string, clientId: string) {

  const bus = buses.get(busId)

  if (!bus) return

  bus.listeners.add(clientId)

}

export function removeClient(clientId: string) {

  buses.forEach(bus => {

    bus.sources.delete(clientId)
    bus.listeners.delete(clientId)

  })

}

export function getListeners(busId: string) {

  const bus = buses.get(busId)

  if (!bus) return []

  return Array.from(bus.listeners)

}