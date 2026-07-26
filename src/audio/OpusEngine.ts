import { EventEmitter } from "events"

export interface PCMFrame {
  clientId: string
  pcm: Float32Array
}

export class OpusEngine extends EventEmitter {

  decode(clientId: string, packet: Buffer) {

    const samples = new Float32Array(960)

    for (let i = 0; i < samples.length; i++) {
      samples[i] = 0
    }

    const frame: PCMFrame = {
      clientId,
      pcm: samples
    }

    this.emit("pcm_frame", frame)

  }

  removeClient(clientId: string) {}

}