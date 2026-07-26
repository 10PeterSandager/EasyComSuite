/// <reference lib="dom" />
export function createMixer(ctx: AudioContext) {

  const gain = ctx.createGain()
  const eq = ctx.createBiquadFilter()
  const comp = ctx.createDynamicsCompressor()

  gain.connect(eq)
  eq.connect(comp)
  comp.connect(ctx.destination)

  return {

    addStream(stream: MediaStream) {
      const src = ctx.createMediaStreamSource(stream)
      src.connect(gain)
    },

    setGain(v: number) {
      gain.gain.value = v
    },

    setEQ(freq: number, g: number) {
      eq.frequency.value = freq
      eq.gain.value = g
    },

    setGate(threshold: number) {
      comp.threshold.value = threshold
    }

  }

}