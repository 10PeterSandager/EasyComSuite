export interface ClientToServerEvents {

  register: (data: { id: string }) => void

  talk: (data: {
    id: string
    state: boolean
  }) => void

  matrix_route: (data: {
    from: string
    to: string
    enabled: boolean
  }) => void

  opus_frame: (data: {
    clientId: string
    packet: Buffer
    seq: number
  }) => void

}

export interface ServerToClientEvents {

  registered: () => void

  audio_frame: (data: {
    pcm: number[]
  }) => void

  meter_levels: (data: {
    clientId: string
    level: number
  }) => void

}