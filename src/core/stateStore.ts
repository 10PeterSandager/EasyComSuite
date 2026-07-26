type Client = {
  id: string
  socketId: string
}

const clients = new Map<string, Client>()

export function addClient(client: Client) {
  clients.set(client.id, client)
}

export function removeClient(id: string) {
  clients.delete(id)
}

export function getClient(id: string) {
  return clients.get(id)
}

export function getAllClients() {
  return Array.from(clients.values())
}