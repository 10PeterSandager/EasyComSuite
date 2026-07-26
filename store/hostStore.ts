type Client = {
  id: string
  name: string
  level: number
  online: boolean
}

const clients = new Map<string, Client>()

export function setClient(client: Client) {

  clients.set(client.id, client)

}

export function updateClientLevel(id: string, level: number) {

  const c = clients.get(id)

  if (!c) return

  c.level = level

}

export function setClientOnline(id: string, online: boolean) {

  const c = clients.get(id)

  if (!c) return

  c.online = online

}

export function getClient(id: string) {

  return clients.get(id)

}

export function getClients() {

  return Array.from(clients.values())

}

export function removeClient(id: string) {

  clients.delete(id)

}