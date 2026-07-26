export type Role = "host" | "client"
export type VideoSlot = "A" | "B" | "C" | "D"

export interface Peer {
  id: string
  role: Role
  companyId: string
}

export interface RoomState {
  id: string
  companyId: string
  peers: Map<string, Peer>
  talkbackOwner?: string
  videoSlots: {
    A?: string
    B?: string
    C?: string
    D?: string
  }
}

export interface SerializedRoomState {
  id: string
  companyId: string
  peers: {
    id: string
    role: Role
  }[]
  talkbackOwner?: string
  videoSlots: {
    A?: string
    B?: string
    C?: string
    D?: string
  }
}