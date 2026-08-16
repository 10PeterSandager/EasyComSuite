/**
 * intercom.ts – HOST APP version
 * Placér i: client/webrtc/intercom.ts
 */

import { io, Socket } from 'socket.io-client'
import { getDevice, getRecvTransport } from "./mediasoupClient"
const SERVER_URL = typeof window !== "undefined"
  ? window.location.origin
  : "http://localhost:3001"

const _sessionPw = typeof window !== "undefined"
  ? (localStorage.getItem('easycom_host_session_pw') ?? '')
  : ''

export const socket: Socket = io(SERVER_URL, {
  path: '/io',
  auth: { sessionPassword: _sessionPw }
})

socket.on("connect", () => {
  console.log(`[socket] connected as ${socket.id}`)
  // Re-request connection state after reconnect so consumers are rebuilt when
  // the server restarts. Delay slightly to let the server-side socket registration
  // complete before we ask for the connection list.
  setTimeout(() => socket.emit("connections:list"), 300)
})

// 🔥 Gain control from mobile clients
socket.on("client:gain", ({ clientId, channel, gain, bridgeId }: { clientId: string; channel: number; gain: number; bridgeId?: string }) => {
  const setGain = (bridgeCh: number) => {
    // Use global accessor to ensure same module instance as AudioBridge
    const fn = (window as any).__setChannelGain
    if (fn) {
      fn(bridgeCh, gain)
      console.log(`[gain] ${clientId} ch${channel} → bridge-ch${bridgeCh}: ${(gain * 100).toFixed(0)}%`)
    }
  }
  if (bridgeId) {
    const match = bridgeId.match(/bridge-ch(\d+)/)
    setGain(match ? parseInt(match[1]) : channel)
  } else {
    socket.emit("connections:list", (conns: any[]) => {
      const conn = conns.find((c: any) => c.to === clientId && c.channel === channel)
      const match = conn?.from?.match(/bridge-ch(\d+)/)
      setGain(match ? parseInt(match[1]) : channel)
    })
  }
})
socket.on("disconnect", () => console.log("[socket] disconnected"))

// Clean up stale consumer when a remote producer closes (e.g. phone releases TB).
// Without this, consumers.has(clientId) stays true and the next routing:update skips re-consuming.
socket.on("producer:closed", ({ clientId }: { clientId: string }) => {
  const consumer = consumers.get(clientId)
  if (consumer) {
    try { consumer.close() } catch {}
    disconnectConsumerSource(clientId)
    detachOutputAudio(clientId)
    consumers.delete(clientId)
    consumerChannels.delete(clientId)
    resetLevel(`recv_${clientId}`)
    talkingState.set(clientId, false)
    console.log(`[CONSUME] cleaned up stale consumer for closed producer: ${clientId}`)
  }
})

// Per-client talking state on HOST side.
// Needed to de-duplicate: tone mode sends 4×client:talking (one per channel) → 4×client:state:update.
// Only rebuild the audio path on the FIRST isTalking:true (idle→talking transition).
const talkingState = new Map<string, boolean>()

// state:update controls audio for all sources:
// Non-bridge (phone): sets el.volume 0/1 on the <audio> element directly.
// Bridge: controls the GainNode gate and ensures the driver element is alive.
socket.on("client:state:update", ({ clientId, isTalking }: { clientId: string; isTalking?: boolean }) => {
  if (isTalking === undefined) return

  if (isTalking) {
    const wasTalking = talkingState.get(clientId) || false
    talkingState.set(clientId, true)

    if (!wasTalking) {
      console.log(`[GATE] "${clientId}" talk-start`)
    }

    if (clientId.startsWith("bridge-")) {
      // Bridge: GainNode gate + ensure driver element is alive
      const g = gateGains.get(clientId)
      if (g) g.gain.setTargetAtTime(1, audioCtx.currentTime, 0.02)
      const consumer = consumers.get(clientId)
      if (consumer) {
        const existingEl = outputAudios.get(clientId)
        if (existingEl) {
          if (existingEl.paused) existingEl.play().catch(() => {})
        } else {
          attachOutputAudio(clientId, consumer.track)
        }
      }
    } else {
      // Non-bridge (phone): open gate on talk-start
      const gate = gateGains.get(clientId)
      if (gate) gate.gain.setTargetAtTime(1, audioCtx.currentTime, 0.02)
    }

  } else {
    if (talkingState.get(clientId)) {
      talkingState.set(clientId, false)
      console.log(`[GATE] "${clientId}" talk-stop`)
      if (clientId.startsWith("bridge-")) {
        const gate = gateGains.get(clientId)
        if (gate) gate.gain.setTargetAtTime(0, audioCtx.currentTime, 0.05)
      } else {
        // Non-bridge (phone): close gate on talk-stop
        const gate = gateGains.get(clientId)
        if (gate) gate.gain.setTargetAtTime(0, audioCtx.currentTime, 0.05)
      }
    }
  }
})

// When host finishes producing a stereo pair, register the pair and upgrade any active mono consumers
socket.on("bridge:stereo:available", ({ chL, chR }: { chL: number; chR: number; stereoId: string }) => {
  currentStereoPairs.set(chL, chR)
  // Don't consume here — routing:update will call consumeStereo when bridge channels
  // appear in effective routing. Consuming unconditionally was causing all 30 audio
  // interface channels to play through HOST speakers before any routing was configured.
})

/* ── AUDIO LEVELS ── */

let audioLevels: Record<string, number> = {}
type LevelListener = (levels: Record<string, number>) => void
const levelListeners = new Set<LevelListener>()

export function subscribeToLevels(fn: LevelListener): () => void {
  levelListeners.add(fn); fn({ ...audioLevels })
  return () => levelListeners.delete(fn)
}

function pushLevel(key: string, value: number) {
  audioLevels[key] = value
  levelListeners.forEach(fn => fn({ ...audioLevels }))
}

export function resetLevel(key: string) {
  audioLevels[key] = 0
  levelListeners.forEach(fn => fn({ ...audioLevels }))
}

export function getAudioLevel(id: string) { return audioLevels[id] || 0 }

const _decayTimers = new Map<string, ReturnType<typeof setTimeout>>()

socket.on("audio:levels", (levels: Record<string, number>) => {
  for (const [key, val] of Object.entries(levels)) {
    audioLevels[key] = val
    const existing = _decayTimers.get(key)
    if (existing) clearTimeout(existing)
    if (val > 0) {
      _decayTimers.set(key, setTimeout(() => {
        audioLevels[key] = 0
        levelListeners.forEach(fn => fn({ ...audioLevels }))
        _decayTimers.delete(key)
      }, 500))
    } else {
      _decayTimers.delete(key)
    }
  }
  levelListeners.forEach(fn => fn({ ...audioLevels }))
})

/* ── RMS ── */

function rmsFromAnalyser(analyser: AnalyserNode): number {
  const buf = new Float32Array(analyser.fftSize)
  analyser.getFloatTimeDomainData(buf)
  let sum = 0
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i]
  return Math.min(100, Math.max(0, Math.sqrt(sum / buf.length) * 350))
}

/* ── MIC LEVEL METER ── */

export function startLevelMeter(stream: MediaStream, clientId: string): () => void {
  const ctx = new AudioContext(); ctx.resume()
  const src = ctx.createMediaStreamSource(stream)
  const analyser = ctx.createAnalyser()
  analyser.fftSize = 2048; analyser.smoothingTimeConstant = 0.4
  src.connect(analyser)
  let raf: number; let stopped = false
  const tick = () => {
    if (stopped) return
    const level = rmsFromAnalyser(analyser)
    pushLevel(clientId, level)
    socket.emit("audio:level", { clientId, level })
    raf = requestAnimationFrame(tick)
  }
  raf = requestAnimationFrame(tick)
  return () => { stopped = true; cancelAnimationFrame(raf); ctx.close(); resetLevel(clientId) }
}

/* ── TONE LEVEL METER ── */

let toneRaf: number | null = null
let toneMeterClientId: string | null = null

export function startToneLevelMeter(analyser: AnalyserNode, clientId: string) {
  stopToneLevelMeter()
  toneMeterClientId = clientId
  const tick = () => {
    const level = rmsFromAnalyser(analyser)
    pushLevel(clientId, level)
    socket.emit("audio:level", { clientId, level })
    toneRaf = requestAnimationFrame(tick)
  }
  tick()
}

export function stopToneLevelMeter() {
  if (toneRaf !== null) { cancelAnimationFrame(toneRaf); toneRaf = null }
  if (toneMeterClientId) {
    resetLevel(toneMeterClientId)
    socket.emit("audio:level", { clientId: toneMeterClientId, level: 0 })
    toneMeterClientId = null
  }
}

/* ── AUDIO CONTEXT + RECEIVE LEVEL METER ── */

export const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
(window as any).__audioLevels = audioLevels;
(window as any).__audioCtx = audioCtx

function forceStereoDestination() {
  try {
    if (audioCtx.destination.maxChannelCount >= 2) {
      audioCtx.destination.channelCount = 2
      audioCtx.destination.channelCountMode = 'explicit'
      audioCtx.destination.channelInterpretation = 'speakers'
    }
  } catch {}
}

// Try immediately, and again when the context is running — on iOS, maxChannelCount is 0 or 1
// while suspended (hardware not yet allocated), so the first attempt often silently fails
forceStereoDestination()
audioCtx.onstatechange = () => {
  if (audioCtx.state === 'running') {
    forceStereoDestination()
  } else {
    audioCtx.resume().catch(() => {})
  }
}
const mixers: Record<number, GainNode> = {}
const panners = new Map<number, StereoPannerNode>()
let muted = false

export function setMuted(state: boolean) { muted = state }

export function setReceiverGain(channel: number, gain: number) {
  getMixer(channel).gain.value = gain
}

// Always route through a panner (pan=0 by default), so live pan changes work without re-consuming
function getPanner(channel: number): StereoPannerNode {
  if (!panners.has(channel)) {
    const panner = audioCtx.createStereoPanner()
    panner.pan.value = 0
    panner.connect(getMixer(channel))
    panners.set(channel, panner)
  }
  return panners.get(channel)!
}

export function setPanForChannel(ch: number, pan: number) {
  getPanner(ch).pan.value = Math.max(-1, Math.min(1, pan))
}

export function clearPanForChannel(ch: number) {
  const panner = panners.get(ch)
  if (panner) panner.pan.value = 0
}

export function setStereoPairs(pairs: [number, number][]) {
  // Close stereo consumers for pairs that are no longer stereo
  const newPairMap = new Map(pairs.map(([l, r]) => [l, r]))
  for (const [chL, chR] of currentStereoPairs.entries()) {
    if (!newPairMap.has(chL)) {
      const stereoId = `bridge-stereo-${chL}-${chR}`
      const c = stereoConsumers.get(stereoId)
      if (c) { try { c.close() } catch {} disconnectStereoNodes(stereoId); stereoConsumers.delete(stereoId) }
    }
  }
  currentStereoPairs = newPairMap

  // Attempt stereo consume for each new pair (no-op if producer not ready yet)
  for (const [chL, chR] of currentStereoPairs.entries()) {
    consumeStereo(chL, chR)
  }
}

function getMixer(channel: number): GainNode {
  if (!mixers[channel]) {
    const gain = audioCtx.createGain()
    gain.connect(audioCtx.destination)
    mixers[channel] = gain
  }
  return mixers[channel]
}

/* ── RECEIVE-SIDE TEST TONE ── */

type TestToneHandle = { osc: OscillatorNode; gain: GainNode; raf: number }
const testTones = new Map<string, TestToneHandle>()

export function startTestTone(sourceId: string, channel: number, freq = 1000) {
  stopTestTone(sourceId)
  if (audioCtx.state !== 'running') audioCtx.resume().catch(() => {})
  const osc = audioCtx.createOscillator()
  osc.type = 'sine'
  osc.frequency.value = freq
  const gain = audioCtx.createGain()
  gain.gain.value = 0.15
  const analyser = audioCtx.createAnalyser()
  analyser.fftSize = 2048; analyser.smoothingTimeConstant = 0.4
  osc.connect(gain)
  gain.connect(analyser)
  gain.connect(getMixer(channel))
  // Force analyser to be processed
  const zeroGain = audioCtx.createGain(); zeroGain.gain.value = 0
  analyser.connect(zeroGain); zeroGain.connect(audioCtx.destination)
  osc.start()
  let raf: number
  const tick = () => {
    pushLevel(`recv_${sourceId}`, rmsFromAnalyser(analyser))
    raf = requestAnimationFrame(tick)
  }
  raf = requestAnimationFrame(tick)
  testTones.set(sourceId, { osc, gain, raf })
  console.log(`[TEST TONE] started for "${sourceId}" ch${channel} @ ${freq}Hz`)
}

export function stopTestTone(sourceId: string) {
  const h = testTones.get(sourceId)
  if (!h) return
  cancelAnimationFrame(h.raf)
  try { h.osc.stop() } catch {}
  try { h.osc.disconnect(); h.gain.disconnect() } catch {}
  testTones.delete(sourceId)
  resetLevel(`recv_${sourceId}`)
  console.log(`[TEST TONE] stopped for "${sourceId}"`)
}

export function isTestToneActive(sourceId: string) {
  return testTones.has(sourceId)
}

const recvRafs = new Map<string, number>()

export function startReceiveLevelMeter(stream: MediaStream, sourceId: string) {
  const existing = recvRafs.get(sourceId)
  if (existing) cancelAnimationFrame(existing)
  const src = audioCtx.createMediaStreamSource(stream)
  const analyser = audioCtx.createAnalyser()
  analyser.fftSize = 2048; analyser.smoothingTimeConstant = 0.4
  src.connect(analyser)
  // Chrome uses pull-from-destination rendering — analyser only processes when reachable from destination
  const zeroGain = audioCtx.createGain()
  zeroGain.gain.value = 0
  analyser.connect(zeroGain)
  zeroGain.connect(audioCtx.destination)
  const tick = () => {
    const level = rmsFromAnalyser(analyser)
    pushLevel(`recv_${sourceId}`, level)
    recvRafs.set(sourceId, requestAnimationFrame(tick))
  }
  tick()
}

const consumerSources = new Map<string, MediaStreamAudioSourceNode>()
type StereoNodes = { src: MediaStreamAudioSourceNode; splitter: ChannelSplitterNode; gainL: GainNode; gainR: GainNode; chL: number; chR: number }
const stereoNodes = new Map<string, StereoNodes>()
const trackUnmuteListeners = new Map<string, { track: MediaStreamTrack; listener: () => void }>()

export function setStereoGain(chL: number, chR: number, value: number) {
  const clamped = Math.max(0, Math.min(1, value))
  setReceiverGain(chL, clamped)
  setReceiverGain(chR, clamped)
}

export function setStereoPan(chL: number, chR: number, value: number) {
  setPanForChannel(chL, Math.max(-1, Math.min(1, value)))
  setPanForChannel(chR, Math.max(-1, Math.min(1, value)))
}

function disconnectConsumerSource(sourceId: string) {
  const node = consumerSources.get(sourceId)
  if (node) { try { node.disconnect() } catch {} consumerSources.delete(sourceId) }
}

function removeUnmuteListener(sourceId: string) {
  const entry = trackUnmuteListeners.get(sourceId)
  if (entry) {
    entry.track.removeEventListener('unmute', entry.listener)
    trackUnmuteListeners.delete(sourceId)
  }
}

function disconnectStereoNodes(stereoId: string) {
  const nodes = stereoNodes.get(stereoId)
  if (nodes) {
    try { nodes.gainL.disconnect() } catch {}
    try { nodes.gainR.disconnect() } catch {}
    try { nodes.splitter.disconnect() } catch {}
    try { nodes.src.disconnect() } catch {}
    stereoNodes.delete(stereoId)
  }
}

// Sets up the Web Audio graph for a consumed track.
//
// Non-bridge (phone): MASN from track + vol=0 driver <audio> element (added by caller).
//   vol=0 keeps the WebRTC RTP decoder active (unlike no element, which may leave it dormant in Chrome).
//   vol=0 ≠ el.muted: volume=0 silences native output but keeps the decoder running.
//   MASN reads from the track directly — not from the element — so gate/gain work normally.
//   Signal chain: MASN → gate(0) → clientGain → panner → destination
//
// Bridge: MASN from stream + silent <audio> driver created by attachOutputAudio().
function setupAudioPath(stream: MediaStream, sourceId: string, channel: number) {
  const existingRaf = recvRafs.get(sourceId)
  if (existingRaf) cancelAnimationFrame(existingRaf)

  if (audioCtx.state !== 'running') audioCtx.resume().catch(() => {})

  if (!sourceId.startsWith("bridge-")) {
    // Pure MASN: sole consumer, no element, no native leakthrough
    disconnectConsumerSource(sourceId)
    const src = audioCtx.createMediaStreamSource(stream)
    consumerSources.set(sourceId, src)

    // Metering branch (silent — analyser must be reachable from destination to be processed)
    const analyser = audioCtx.createAnalyser()
    analyser.fftSize = 2048; analyser.smoothingTimeConstant = 0.4
    src.connect(analyser)
    const zeroGain = audioCtx.createGain(); zeroGain.gain.value = 0
    analyser.connect(zeroGain); zeroGain.connect(audioCtx.destination)
    const meterBuf = new Float32Array(analyser.fftSize)
    let ngOpen: boolean | null = null
    const tick = () => {
      analyser.getFloatTimeDomainData(meterBuf)
      let s = 0; for (let i = 0; i < meterBuf.length; i++) s += meterBuf[i] * meterBuf[i]
      const rawRms = Math.sqrt(s / meterBuf.length)
      const isTalking = talkingState.get(sourceId)
      const scaledLevel = Math.min(100, rawRms * 350)
      pushLevel(`recv_${sourceId}`, scaledLevel)
      if (isTalking) pushLevel(sourceId, scaledLevel)

      // Noise gate: only active while TB is open; gate node lives in clientNoiseGateNodes
      const ngSettings = clientNoiseGateSettings.get(sourceId)
      const ng = clientNoiseGateNodes.get(sourceId)
      if (ng && ngSettings?.enabled && isTalking) {
        const dbLevel = rawRms > 0 ? 20 * Math.log10(rawRms) : -100
        const shouldOpen = dbLevel > ngSettings.threshold
        if (shouldOpen !== ngOpen) {
          ng.gain.setTargetAtTime(shouldOpen ? 1 : 0, audioCtx.currentTime, shouldOpen ? 0.010 : 0.005)
          ngOpen = shouldOpen
        }
      } else if (ng && ngOpen !== true) {
        // Gate not enabled or TB closed — keep open
        ng.gain.setTargetAtTime(1, audioCtx.currentTime, 0.010)
        ngOpen = true
      }

      recvRafs.set(sourceId, requestAnimationFrame(tick))
    }
    tick()

    // Audio routing: MASN → gate → clientGain → eqLow → eqMid → eqHigh → noiseGate → panner
    const gate = getGateGain(sourceId)
    const clientGain = getClientGain(sourceId)
    try { gate.disconnect() } catch {}
    try { clientGain.disconnect() } catch {}
    ;[clientEQNodesLow, clientEQNodesMid, clientEQNodesHigh, clientNoiseGateNodes].forEach(m => {
      const n = m.get(sourceId); if (n) { try { n.disconnect() } catch {} m.delete(sourceId) }
    })

    const savedEQ = clientEQValues.get(sourceId) ?? { low: 0, mid: 0, high: 0 }
    const eqLow = audioCtx.createBiquadFilter()
    eqLow.type = 'lowshelf'; eqLow.frequency.value = 200; eqLow.gain.value = savedEQ.low
    clientEQNodesLow.set(sourceId, eqLow)

    const eqMid = audioCtx.createBiquadFilter()
    eqMid.type = 'peaking'; eqMid.frequency.value = 1000; eqMid.Q.value = 0.7; eqMid.gain.value = savedEQ.mid
    clientEQNodesMid.set(sourceId, eqMid)

    const eqHigh = audioCtx.createBiquadFilter()
    eqHigh.type = 'highshelf'; eqHigh.frequency.value = 5000; eqHigh.gain.value = savedEQ.high
    clientEQNodesHigh.set(sourceId, eqHigh)

    const noiseGate = audioCtx.createGain()
    noiseGate.gain.value = 1
    clientNoiseGateNodes.set(sourceId, noiseGate)

    src.connect(gate)
    gate.connect(clientGain)
    clientGain.connect(eqLow)
    eqLow.connect(eqMid)
    eqMid.connect(eqHigh)
    eqHigh.connect(noiseGate)
    noiseGate.connect(getPanner(channel))

    console.log(`[PATH] "${sourceId}" ch${channel} | MASN→gate→EQ→noiseGate→panner | ctx: ${audioCtx.state}`)
    return
  }

  // Bridge path: MASN → metering + panner (driver element created in attachOutputAudio)
  disconnectConsumerSource(sourceId)
  if (muted) return
  const src = audioCtx.createMediaStreamSource(stream)
  consumerSources.set(sourceId, src)
  const analyser = audioCtx.createAnalyser()
  analyser.fftSize = 2048; analyser.smoothingTimeConstant = 0.4
  src.connect(analyser)
  const zeroGain = audioCtx.createGain(); zeroGain.gain.value = 0
  analyser.connect(zeroGain); zeroGain.connect(audioCtx.destination)
  const tick = () => {
    pushLevel(`recv_${sourceId}`, rmsFromAnalyser(analyser))
    recvRafs.set(sourceId, requestAnimationFrame(tick))
  }
  tick()
  src.connect(getPanner(channel))
  console.log(`[PATH] bridge "${sourceId}" ch${channel} → panner | ctx: ${audioCtx.state}`)
}

/* ── CONSUMERS ── */

const consumers = new Map<string, any>()
const consumerChannels = new Map<string, number>()
const stereoConsumers = new Map<string, any>()           // stereoId → consumer
let currentStereoPairs = new Map<number, number>()       // chL → chR
const pendingConsumes = new Set<string>()                // in-flight consume keys
;(window as any).__consumers = consumers
const pendingStereo = new Set<string>()
// clientId → channel for non-bridge sources with stored connections to us.
// Persists across producer:closed events so producer:ready can pre-consume immediately
// (producer:ready fires before routing:update due to 100ms debounce on broadcastRouting).
const preConsumeTargets = new Map<string, number>()

// Silent driver <audio> elements for BRIDGE sources only.
// Non-bridge (mobile) sources use no element — MASN alone drives WebRTC decoding and is
// the sole jitter-buffer consumer (element + MASN = dual consumer = motor chop).
const outputAudios = new Map<string, HTMLAudioElement>()
// Unused for non-bridge (kept for setAudioOutputDevice compat, always empty for non-bridge)
const mediaSources = new Map<string, MediaElementAudioSourceNode>()
let currentOutputDeviceId: string | null = null

// Gate GainNode per non-bridge source: 0 when idle, 1 when talking.
const gateGains = new Map<string, GainNode>()
function getGateGain(sourceId: string): GainNode {
  if (!gateGains.has(sourceId)) {
    const g = audioCtx.createGain()
    g.gain.value = 0
    gateGains.set(sourceId, g)
  }
  return gateGains.get(sourceId)!
}

// Per-client output gain GainNode
const clientGainNodes = new Map<string, GainNode>()
function getClientGain(sourceId: string): GainNode {
  if (!clientGainNodes.has(sourceId)) {
    const gain = audioCtx.createGain()
    gain.gain.value = clientMuteValues.get(sourceId) ? 0 : (clientGainValues.get(sourceId) ?? 1.0)
    clientGainNodes.set(sourceId, gain)
  }
  return clientGainNodes.get(sourceId)!
}

// Per-client DSP settings
const clientNoiseGateSettings = new Map<string, { enabled: boolean; threshold: number }>()
const clientMuteValues = new Map<string, boolean>()
const clientGainValues = new Map<string, number>()
const clientEQValues = new Map<string, { low: number; mid: number; high: number }>()

// Per-client EQ filter nodes and noise gate nodes (non-bridge sources)
const clientEQNodesLow  = new Map<string, BiquadFilterNode>()
const clientEQNodesMid  = new Map<string, BiquadFilterNode>()
const clientEQNodesHigh = new Map<string, BiquadFilterNode>()
const clientNoiseGateNodes = new Map<string, GainNode>()

function attachOutputAudio(sourceId: string, track: MediaStreamTrack) {
  detachOutputAudio(sourceId)
  const el = document.createElement('audio')
  el.srcObject = new MediaStream([track])
  el.volume = 1
  // Non-bridge (phone): start muted so DTX comfort noise is suppressed before TB pressed.
  // el.muted suppresses rendering but keeps the jitter buffer draining — unlike el.volume=0
  // which starves the buffer and causes sawtooth artifacts when the gate opens.
  if (!sourceId.startsWith("bridge-")) el.muted = true
  el.autoplay = true
  el.play().catch(() => {})
  outputAudios.set(sourceId, el)
}

function detachOutputAudio(sourceId: string) {
  removeUnmuteListener(sourceId)
  const maesn = mediaSources.get(sourceId)
  if (maesn) { try { maesn.disconnect() } catch {} mediaSources.delete(sourceId) }
  const gate = gateGains.get(sourceId)
  if (gate) { try { gate.disconnect() } catch {} gateGains.delete(sourceId) }
  const gain = clientGainNodes.get(sourceId)
  if (gain) { try { gain.disconnect() } catch {} clientGainNodes.delete(sourceId) }
  ;[clientEQNodesLow, clientEQNodesMid, clientEQNodesHigh, clientNoiseGateNodes].forEach(m => {
    const n = m.get(sourceId); if (n) { try { n.disconnect() } catch {} m.delete(sourceId) }
  })
  const el = outputAudios.get(sourceId)
  if (!el) return
  el.pause()
  el.srcObject = null
  outputAudios.delete(sourceId)
}                  // in-flight stereo consume ids

// Returns true if ch is covered by a live stereo consumer.
// If the consumer exists but its track has ended, cleans it up and returns false.
function hasActiveStereoConsumer(ch: number): boolean {
  for (const [chL, chR] of currentStereoPairs.entries()) {
    if (ch !== chL && ch !== chR) continue
    const stereoId = `bridge-stereo-${chL}-${chR}`
    const c = stereoConsumers.get(stereoId)
    if (!c) continue
    if (c.track?.readyState === 'live') return true
    // Stale — disconnect graph nodes and remove so consumeStereo will re-establish it
    try { c.close() } catch {}
    disconnectStereoNodes(stereoId)
    stereoConsumers.delete(stereoId)
  }
  return false
}

/* ── ROUTING ── */

export function initRouting(clientId: string) {
  console.log(`[ROUTING] initRouting for "${clientId}"`)

  // Don't pre-consume stereo pairs here. routing:update will call consumeStereo
  // when bridge channels appear in effective routing. Auto-consuming all pairs
  // on init creates 15+ mediasoup consumers unconditionally and routes ALL
  // audio interface inputs to the destination before any routing is configured.

  socket.off("routing:update")
  socket.off("connections:all")
  socket.off("producer:ready")

  // Pull current state immediately so consumers are pre-created before first TB press,
  // even if the phone was already connected when initRouting was called.
  socket.emit("connections:list")

  // Pre-create consumers for all non-bridge mobile clients connected to us.
  // The consumer starts paused (producer is paused), so no audio flows until the
  // mobile client unpauses their mic (TB pressed). This eliminates the 100-300ms
  // consume-setup latency that was causing the first TB press to produce no audio.
  socket.on("connections:all", (allConnections: any[]) => {
    const toMe = allConnections.filter(c => c.to === clientId && !c.from.startsWith("bridge-"))
    const activeSources = new Set(toMe.map((c: any) => c.from))

    // Track ALL stored phone connections so producer:ready can pre-consume on first TB press
    for (const c of toMe) preConsumeTargets.set(c.from, c.channel)
    for (const [id] of preConsumeTargets.entries()) {
      if (!activeSources.has(id)) preConsumeTargets.delete(id)
    }

    // Close non-bridge consumers for clients that have fully disconnected
    for (const [id, consumer] of consumers.entries()) {
      if (!id.startsWith("bridge-") && !activeSources.has(id)) {
        try { consumer.close() } catch {}
        disconnectConsumerSource(id)
        detachOutputAudio(id)
        consumers.delete(id); consumerChannels.delete(id)
        resetLevel(`recv_${id}`)
      }
    }

    // Only eagerly pre-consume always-on connections (no toChannel = not TB-gated).
    // TB-gated connections (toChannel defined) are consumed on-demand via producer:ready
    // when the phone actually presses TB and registers a producer.
    // Eagerly consuming TB-gated connections causes a timeout loop when phones are idle.
    for (const c of toMe) {
      if (c.toChannel === undefined) consume(c.from, c.channel)
    }
  })

  // producer:ready fires immediately when the phone registers a new producer.
  // routing:update is debounced 100ms — so this gives us a 100ms head-start to
  // create the consumer before routing:update arrives, eliminating the window where
  // talk-stop fires before the audio path is ready.
  socket.on("producer:ready", ({ clientId: sourceId }: { clientId: string }) => {
    if (sourceId.startsWith("bridge-")) return
    const channel = preConsumeTargets.get(sourceId)
    if (channel === undefined) return
    console.log(`[CONSUME] producer:ready "${sourceId}" ch${channel} — pre-consuming (ahead of routing:update)`)
    consume(sourceId, channel)
  })

  socket.on("routing:update", async (connections: any[]) => {
    const toMe = connections.filter(c => c.to === clientId)
    console.log(`[ROUTING] update: ${connections.length} total, ${toMe.length} to me`, toMe)

    const newRouting: Record<number, string[]> = {}
    toMe.forEach(c => {
      if (!newRouting[c.channel]) newRouting[c.channel] = []
      newRouting[c.channel].push(c.from)
    })

    // Close consumers that are no longer in effective routing.
    // Bridge consumers are always closed on removal.
    // Mobile phone mics (client-* IDs) stay alive — producer-pause state gates their audio.
    // HOST sources (producer-65 etc.) must be closed when removed; they never pause.
    const active = new Set(Object.values(newRouting).flat())
    for (const [id, consumer] of consumers.entries()) {
      const isMobileMic = !id.startsWith("bridge-") && !id.startsWith("producer-")
      if (!active.has(id) && !isMobileMic) {
        try { consumer.close() } catch {}
        disconnectConsumerSource(id)
        detachOutputAudio(id)
        consumers.delete(id); consumerChannels.delete(id)
        resetLevel(`recv_${id}`)
      }
    }

    // Bridge channels in a stereo pair skip mono consume — handled by consumeStereo.
    // Non-bridge sources (mobile clients etc.) always get a mono consumer even if
    // they happen to route on a channel number that is also a stereo-pair channel.
    const stereoChannels = new Set<number>()
    for (const [chL, chR] of currentStereoPairs.entries()) {
      stereoChannels.add(chL); stereoChannels.add(chR)
    }

    for (const [ch, sources] of Object.entries(newRouting)) {
      const chNum = Number(ch)
      for (const src of sources) {
        const isBridge = src.startsWith("bridge-")
        if (stereoChannels.has(chNum) && isBridge) continue
        await consume(src, chNum)
      }
    }

    // Upgrade bridge channels to stereo where available
    for (const [chL, chR] of currentStereoPairs.entries()) {
      const hasBridgeL = (newRouting[chL] || []).some(s => s.startsWith("bridge-"))
      const hasBridgeR = (newRouting[chR] || []).some(s => s.startsWith("bridge-"))
      if (hasBridgeL || hasBridgeR) {
        consumeStereo(chL, chR)
      }
    }
  })
}

/* ── CONSUME ── */

async function consume(sourceId: string, channel: number) {
  const existing = consumers.get(sourceId)
  if (existing && consumerChannels.get(sourceId) === channel) {
    // Only skip if track is still live — ended track means server restarted
    if (existing.track?.readyState === 'live') return
    // Stale consumer from server restart: tear down and recreate
    console.log(`[CONSUME] stale consumer for "${sourceId}" (track ${existing.track?.readyState}) — recreating`)
    try { existing.close() } catch {}
    disconnectConsumerSource(sourceId)
    detachOutputAudio(sourceId)
    consumers.delete(sourceId)
    consumerChannels.delete(sourceId)
    resetLevel(`recv_${sourceId}`)
  }
  const key = `${sourceId}:${channel}`
  if (pendingConsumes.has(key)) return
  pendingConsumes.add(key)

  const device = getDevice()
  const recvTransport = getRecvTransport()

  console.log(`[CONSUME] "${sourceId}" ch${channel} | device=${!!device} recvTransport=${!!recvTransport}`)

  if (!device || !recvTransport) {
    console.warn(`[CONSUME] ❌ mediasoup not ready for "${sourceId}"`)
    return
  }

  try {
    const result = await new Promise<any>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`timeout for ${sourceId}`)), 8000)
      socket.emit("consume:request", {
        targetId: sourceId,
        rtpCapabilities: device.rtpCapabilities,
        transportId: recvTransport.id
      }, (res: any) => { clearTimeout(t); resolve(res) })
    })

    console.log(`[CONSUME] response for "${sourceId}":`, result)

    if (!result || result.error) {
      console.warn(`[CONSUME] ❌ "${sourceId}": ${result?.error}`)
      return
    }

    const { id, producerId, kind, rtpParameters } = result
    if (!id || !producerId || !rtpParameters) return

    const consumer = await recvTransport.consume({ id, producerId, kind, rtpParameters })
    if (consumer.resume) await consumer.resume()

    consumers.set(sourceId, consumer)
    consumerChannels.set(sourceId, channel)

    if (sourceId.startsWith("bridge-")) {
      // Bridge: silent driver element keeps WebRTC pipeline alive, then MASN → panner
      attachOutputAudio(sourceId, consumer.track)
      setupAudioPath(new MediaStream([consumer.track]), sourceId, channel)
    } else {
      // Non-bridge (phone): MASN for Web Audio processing + vol=0 driver element to keep
      // the WebRTC decoder active. vol=0 (not el.muted) suppresses native output while
      // keeping the RTP decoder running; MASN reads from the track directly so gate/gain work.
      // setupAudioPath first — it creates the gate GainNode we need below.
      setupAudioPath(new MediaStream([consumer.track]), sourceId, channel)
      // Replace old driver element without calling detachOutputAudio (that would delete gate/clientGain)
      const oldEl = outputAudios.get(sourceId)
      if (oldEl) { oldEl.pause(); oldEl.srcObject = null; outputAudios.delete(sourceId) }
      const driverEl = document.createElement('audio')
      driverEl.srcObject = new MediaStream([consumer.track])
      driverEl.volume = 0
      driverEl.autoplay = true
      driverEl.play().catch(() => {})
      outputAudios.set(sourceId, driverEl)
      // Race: isTalking:true may have arrived before consumer was ready — open gate now
      if (talkingState.get(sourceId)) {
        const gate = gateGains.get(sourceId)
        if (gate) gate.gain.setTargetAtTime(1, audioCtx.currentTime, 0.02)
      }
    }

    console.log(`[CONSUME] ✅ "${sourceId}" → ch${channel} | track: ${consumer.track.readyState} | muted: ${consumer.track.muted} | path: wired`)
  } catch (e) {
    console.error(`[CONSUME] ❌ exception "${sourceId}":`, e)
  } finally {
    pendingConsumes.delete(key)
  }
}

/* ── STEREO CONSUME ── */

async function consumeStereo(chL: number, chR: number) {
  const stereoId = `bridge-stereo-${chL}-${chR}`
  if (stereoConsumers.has(stereoId)) return
  if (pendingStereo.has(stereoId)) return
  pendingStereo.add(stereoId)

  const device = getDevice()
  const recvTransport = getRecvTransport()
  if (!device || !recvTransport) { pendingStereo.delete(stereoId); return }

  try {
    const result = await new Promise<any>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`timeout ${stereoId}`)), 8000)
      socket.emit("consume:request", {
        targetId: stereoId,
        rtpCapabilities: device.rtpCapabilities,
        transportId: recvTransport.id
      }, (res: any) => { clearTimeout(t); resolve(res) })
    })

    if (!result || result.error) {
      // Stereo producer not ready yet — mono fallback stays active
      return
    }

    const { id, producerId, kind, rtpParameters } = result
    if (!id || !producerId || !rtpParameters) return

    const consumer = await recvTransport.consume({ id, producerId, kind, rtpParameters })
    if (consumer.resume) await consumer.resume()

    stereoConsumers.set(stereoId, consumer)

    // Disconnect mono nodes FIRST — no overlap window where both play simultaneously
    for (const [srcId, c] of consumers.entries()) {
      const ch = consumerChannels.get(srcId)
      if (ch === chL || ch === chR) {
        disconnectConsumerSource(srcId)
        try { c.close() } catch {}
        consumers.delete(srcId)
        consumerChannels.delete(srcId)
        resetLevel(`recv_${srcId}`)
      }
    }

    // Route via ChannelSplitter → individual per-channel panners
    // This preserves phase coherence (single jitter buffer) while keeping independent pan per channel
    disconnectStereoNodes(stereoId)
    const stream = new MediaStream([consumer.track])
    const src = audioCtx.createMediaStreamSource(stream)
    const splitter = audioCtx.createChannelSplitter(2)
    src.connect(splitter)

    const gainL = audioCtx.createGain()
    splitter.connect(gainL, 0)   // stereo left → chL panner
    gainL.connect(getPanner(chL))

    const gainR = audioCtx.createGain()
    splitter.connect(gainR, 1)   // stereo right → chR panner
    gainR.connect(getPanner(chR))

    stereoNodes.set(stereoId, { src, splitter, gainL, gainR, chL, chR })

    console.log(`[STEREO] ✅ "${stereoId}" → ch${chL}(pan=${getPanner(chL).pan.value.toFixed(2)}) + ch${chR}(pan=${getPanner(chR).pan.value.toFixed(2)})`)
  } catch (e) {
    console.error(`[STEREO] ❌ exception "${stereoId}":`, e)
  } finally {
    pendingStereo.delete(stereoId)
  }
}

/* ── HELPERS ── */

export function connectToServer() {
  if (!socket.connected) socket.connect()
}

export async function setAudioOutputDevice(deviceId: string): Promise<void> {
  currentOutputDeviceId = deviceId
  try {
    await (audioCtx as any).setSinkId(deviceId)
    console.log(`[audio] audioCtx output → ${deviceId}`)
  } catch (e) {
    console.warn('[audio] audioCtx setSinkId failed:', e)
  }
  for (const [id, el] of outputAudios.entries()) {
    ;(el as any).setSinkId(deviceId).catch((err: any) =>
      console.warn(`[audio] el setSinkId failed for ${id}:`, err)
    )
  }
}

export async function startMicrophone() {
  return navigator.mediaDevices.getUserMedia({ audio: true })
}

export function talkback(targetId: string, myId: string, channel = 1) {
  socket.emit("connection:create", { from: myId, to: targetId, channel, replace: true })
}

export function createConnection(from: string, to: string, channel: number) {
  socket.emit("connection:create", { from, to, channel })
}

export function removeConnection(from: string, to: string, channel: number) {
  socket.emit("connection:remove", { from, to, channel })
}

export function getConnections(cb: (c: any[]) => void) {
  socket.emit("connections:list", cb)
}

/* ── FEED MONITOR (HOST-LOCAL CUE ONLY — never sent to phone) ── */

type FeedMonitorEntry = { src: MediaStreamAudioSourceNode; gain: GainNode }
const feedMonitorNodes = new Map<string, FeedMonitorEntry>()

export function startFeedMonitor(sourceId: string, stream: MediaStream, volume: number) {
  stopFeedMonitor(sourceId)
  if (audioCtx.state !== 'running') audioCtx.resume().catch(() => {})
  const src = audioCtx.createMediaStreamSource(stream)
  const gain = audioCtx.createGain()
  gain.gain.value = volume / 100
  src.connect(gain)
  gain.connect(audioCtx.destination)
  feedMonitorNodes.set(sourceId, { src, gain })
}

export function stopFeedMonitor(sourceId: string) {
  const nodes = feedMonitorNodes.get(sourceId)
  if (!nodes) return
  try { nodes.src.disconnect() } catch {}
  try { nodes.gain.disconnect() } catch {}
  feedMonitorNodes.delete(sourceId)
}

export function setFeedMonitorVolume(sourceId: string, volume: number) {
  const nodes = feedMonitorNodes.get(sourceId)
  if (nodes) nodes.gain.gain.setTargetAtTime(volume / 100, audioCtx.currentTime, 0.05)
}

export function getClientMonitorStream(sourceId: string): MediaStream | null {
  const consumer = consumers.get(sourceId)
  if (!consumer?.track || consumer.track.readyState !== 'live') return null
  return new MediaStream([consumer.track])
}

/* ── CLIENT DSP CONTROLS ── */

export function setClientGain(sourceId: string, gain: number) {
  clientGainValues.set(sourceId, gain)
  const node = clientGainNodes.get(sourceId)
  if (node && !(clientMuteValues.get(sourceId))) {
    node.gain.setTargetAtTime(gain, audioCtx.currentTime, 0.012)
  }
}

export function setClientEQ(sourceId: string, band: 'low' | 'mid' | 'high', db: number) {
  const saved = clientEQValues.get(sourceId) ?? { low: 0, mid: 0, high: 0 }
  clientEQValues.set(sourceId, { ...saved, [band]: db })
  const node = band === 'low' ? clientEQNodesLow.get(sourceId)
             : band === 'mid' ? clientEQNodesMid.get(sourceId)
             : clientEQNodesHigh.get(sourceId)
  if (node) node.gain.setTargetAtTime(db, audioCtx.currentTime, 0.01)
}

export function setClientGate(sourceId: string, enabled: boolean, threshold: number) {
  clientNoiseGateSettings.set(sourceId, { enabled, threshold })
}

export function setClientMute(sourceId: string, muted: boolean) {
  clientMuteValues.set(sourceId, muted)
  const node = clientGainNodes.get(sourceId)
  if (node) {
    const targetGain = muted ? 0 : (clientGainValues.get(sourceId) ?? 1.0)
    node.gain.setTargetAtTime(targetGain, audioCtx.currentTime, 0.005)
  }
}

/* ── PRESETS ── */

const channelLabels: Record<number, string> = {}
export function setChannelLabel(ch: number, label: string) { channelLabels[ch] = label }
export function getChannelLabel(ch: number) { return channelLabels[ch] || `Channel ${ch}` }

type Preset = { name: string; routing: Record<number, string[]> }
const presets: Preset[] = []
export function savePreset(name: string) { presets.push({ name, routing: {} }) }
export function loadPreset(name: string, myId: string) {
  const p = presets.find(p => p.name === name)
  if (!p) return
  Object.entries(p.routing).forEach(([ch, srcs]) => {
    srcs.forEach(s => socket.emit("connection:create", { from: myId, to: s, channel: Number(ch) }))
  })
}
export function getPresets() { return presets }

/* ── REFERENCE-COUNTED CONNECTIONS ──
 * Multiple owners (TB button, IFB tone) may need the same producer→client
 * connection simultaneously. The connection is only created when the first
 * owner acquires it, and only removed when the last owner releases it.
 */
const _connRefs: Map<string, number> = new Map()

export function acquireConnection(from: string, to: string, channel: number) {
  const key = `${from}>${to}:${channel}`
  const n = (_connRefs.get(key) ?? 0) + 1
  _connRefs.set(key, n)
  if (n === 1) socket.emit("connection:create", { from, to, channel, bidirectional: false })
}

// Subscribes to received audio levels mapped to channel numbers (1-based).
// Uses consumerChannels to map each consumed sourceId → channel → level.
// Call in MobileClientView to drive the IFB receive meters.
export function subscribeToReceivedChannelLevels(cb: (levels: Record<number, number>) => void): () => void {
  const fn = (levels: Record<string, number>) => {
    const channelLevels: Record<number, number> = {}
    for (const [sourceId, channel] of consumerChannels.entries()) {
      const level = levels[`recv_${sourceId}`] ?? 0
      channelLevels[channel] = Math.max(channelLevels[channel] ?? 0, level)
    }
    cb(channelLevels)
  }
  levelListeners.add(fn)
  return () => levelListeners.delete(fn)
}

export function releaseConnection(from: string, to: string, channel: number) {
  const key = `${from}>${to}:${channel}`
  const n = Math.max(0, (_connRefs.get(key) ?? 0) - 1)
  if (n === 0) {
    _connRefs.delete(key)
    socket.emit("connection:remove", { from, to, channel, bidirectional: false })
  } else {
    _connRefs.set(key, n)
  }
}
