import dgram from "dgram"

interface AES67Stream {

  id: string
  address: string
  port: number

}

const streams = new Map<string, AES67Stream>()

const socket = dgram.createSocket("udp4")

export function createStream(id: string, address: string, port: number) {

  streams.set(id, {
    id,
    address,
    port
  })

}

export function sendAudio(streamId: string, audio: Buffer) {

  const stream = streams.get(streamId)

  if (!stream) return

  socket.send(
    audio,
    stream.port,
    stream.address
  )

}