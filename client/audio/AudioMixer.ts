export function createMixer(ctx: AudioContext) {

  const input = ctx.createGain()
  const gain = ctx.createGain()

  /* ---------- EQ ---------- */

  const eqLow = ctx.createBiquadFilter()
  const eqMid = ctx.createBiquadFilter()
  const eqHigh = ctx.createBiquadFilter()

  eqLow.type = "lowshelf"
  eqMid.type = "peaking"
  eqHigh.type = "highshelf"

  eqLow.frequency.value = 200
  eqMid.frequency.value = 1000
  eqHigh.frequency.value = 5000

  /* ---------- COMPRESSOR ---------- */

  const comp = ctx.createDynamicsCompressor()
  comp.threshold.value = -24
  comp.knee.value = 30
  comp.ratio.value = 6
  comp.attack.value = 0.003
  comp.release.value = 0.25

  /* ---------- OUTPUT ---------- */

  input.connect(gain)
  gain.connect(eqLow)
  eqLow.connect(eqMid)
  eqMid.connect(eqHigh)
  eqHigh.connect(comp)
  comp.connect(ctx.destination)

  /* ---------- STATE ---------- */

  let gateEnabled = false
  let gateThreshold = 0.02

  const sources: MediaStreamAudioSourceNode[] = []

  /* ---------- GATE (REAL IMPLEMENTATION) ---------- */

  const analyser = ctx.createAnalyser()
  analyser.fftSize = 256

  gain.connect(analyser)

  const data = new Uint8Array(analyser.frequencyBinCount)

  function gateLoop() {

    analyser.getByteTimeDomainData(data)

    let sum = 0
    for (let i = 0; i < data.length; i++) {
      const v = (data[i] - 128) / 128
      sum += v * v
    }

    const rms = Math.sqrt(sum / data.length)

    if (gateEnabled) {
      gain.gain.value = rms > gateThreshold ? 1 : 0
    }

    requestAnimationFrame(gateLoop)

  }

  gateLoop()

  /* ---------- API ---------- */

  return {

    /* ADD AUDIO */

    addStream(stream: MediaStream) {

      const src = ctx.createMediaStreamSource(stream)
      src.connect(input)

      sources.push(src)

      return () => {
        try {
          src.disconnect()
        } catch {}
      }

    },

    /* GAIN */

    setGain(v: number) {
      gain.gain.value = v / 100
    },

    /* EQ */

    setEQ(low: number, mid: number, high: number) {

      eqLow.gain.value = low
      eqMid.gain.value = mid
      eqHigh.gain.value = high

    },

    /* GATE */

    enableGate(state: boolean) {
      gateEnabled = state
    },

    setGateThreshold(v: number) {
      gateThreshold = v
    },

    /* COMPRESSOR */

    setCompressor(threshold: number, ratio: number) {

      comp.threshold.value = threshold
      comp.ratio.value = ratio

    },

    /* MUTE */

    setMute(state: boolean) {
      gain.gain.value = state ? 0 : 1
    },

    /* CLEANUP */

    destroy() {

      sources.forEach(s => {
        try { s.disconnect() } catch {}
      })

      try {
        input.disconnect()
        gain.disconnect()
        eqLow.disconnect()
        eqMid.disconnect()
        eqHigh.disconnect()
        comp.disconnect()
      } catch {}

    }

  }

}