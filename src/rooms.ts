import { types } from "mediasoup"

export const transports = new Map<string, types.WebRtcTransport>()
export const producers = new Map<string, types.Producer>()
export const consumers = new Map<string, types.Consumer>()

export const clients = new Map<string, any>()