/**
 * AudioBridge.ts – multi-kanal version
 * Alle kanaler deler én AudioContext → samme clock → ingen drift mellem L/R.
 * Bruger AudioBufferSourceNode i stedet for AudioWorklet (universel kompatibilitet).
 */

import { socket } from "../webrtc/intercom"

type BridgeInstance = {
  gainNode: GainNode
  eqLow: BiquadFilterNode
  eqMid: BiquadFilterNode
  eqHigh: BiquadFilterNode
  analyser: AnalyserNode
  gateNode: GainNode
  panNode: StereoPannerNode
  destination: MediaStreamAudioDestinationNode
  stream: MediaStream
  channel: number
  nextPlayTime: number
}

// Single shared AudioContext — all channels use the same clock
let sharedCtx: AudioContext | null = null

async function getSharedCtx(sampleRate: number): Promise<AudioContext> {
  if (!sharedCtx || sharedCtx.state === 'closed') {
    sharedCtx = new AudioContext({ sampleRate })
  }
  if (sharedCtx.state !== 'running') {
    await sharedCtx.resume().catch(() => {})
  }
  return sharedCtx
}

const bridges = new Map<number, BridgeInstance>()
const gainNodes = new Map<number, GainNode>()
const gainValues = new Map<number, number>()
const eqFiltersLow = new Map<number, BiquadFilterNode>()
const eqFiltersMid = new Map<number, BiquadFilterNode>()
const eqFiltersHigh = new Map<number, BiquadFilterNode>()
const eqValues = new Map<number, { low: number; mid: number; high: number }>()
const bridgeGateNodes = new Map<number, GainNode>()
const panNodes = new Map<number, StereoPannerNode>()
const panValues = new Map<number, number>()
const gateSettings = new Map<number, { enabled: boolean; threshold: number }>()
const muteValues = new Map<number, boolean>()
const levelCallbacks = new Map<number, (level: number) => void>()

function handlePcmPacket({ channel, data }: { channel: number; data: ArrayBuffer | Buffer }, batchStart?: number) {
  const bridge = bridges.get(channel)
  if (!bridge || !sharedCtx) return

  const int16 = new Int16Array(
    data instanceof ArrayBuffer ? data : (data as any).buffer.slice((data as any).byteOffset, (data as any).byteOffset + (data as any).byteLength)
  )
  const float32 = new Float32Array(int16.length)
  for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 32768.0

  // DEBUG: track signal on key channels every 500 packets
  if ((channel === 25 || channel === 17) && _pcmPacketCount % 500 === 0) {
    const mx = float32.reduce((m, v) => Math.max(m, Math.abs(v)), 0)
    const byteOff = (data as any).byteOffset ?? 'n/a'
    console.log(`[PCM-DBG] ch${channel}: max=${(mx*100).toFixed(2)}% samples=${int16.length} type=${data.constructor.name} byteOffset=${byteOff}`)
  }

  const buffer = sharedCtx.createBuffer(1, float32.length, sharedCtx.sampleRate)
  buffer.copyToChannel(float32, 0)

  const source = sharedCtx.createBufferSource()
  source.buffer = buffer
  source.connect(bridge.gainNode)

  const now = sharedCtx.currentTime
  const startTime = batchStart !== undefined ? batchStart : Math.max(now + 0.005, bridge.nextPlayTime)
  source.start(startTime)
  bridge.nextPlayTime = startTime + buffer.duration
}

function handleVisibility() {
  if (sharedCtx && document.visibilityState === "visible") {
    sharedCtx.resume().catch(() => {})
  }
}

let pcmListenerActive = false
let _pcmPacketCount = 0

;(window as any).__audioBridgeDebug = {
  get sharedCtxState() { return sharedCtx?.state },
  get sharedCtxTime() { return sharedCtx?.currentTime?.toFixed(2) },
  get bridgeChannels() { return [...bridges.keys()] },
  resumeSharedCtx() { return sharedCtx?.resume() }
}

function handleMultiPcmPacket(packets: Array<{ channel: number; data: ArrayBuffer | Buffer }>) {
  if (!sharedCtx) return
  _pcmPacketCount++
  if (_pcmPacketCount % 1000 === 0) {
    const buf = new Float32Array(1024)
    const active: string[] = []
    for (const [ch, b] of bridges.entries()) {
      b.analyser.getFloatTimeDomainData(buf)
      let s = 0; for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i]
      const lvl = Math.sqrt(s / buf.length) * 400
      if (lvl > 0.5) active.push(`ch${ch}:${lvl.toFixed(0)}%`)
    }
    const summary = active.length ? active.join(' ') : 'ALL SILENT'
    console.log(`[AudioBridge] PCM rx: ${_pcmPacketCount} pkts | bridges=${bridges.size} (${[...bridges.keys()].slice(0,5).join(',')}...) | sharedCtx=${sharedCtx.state} t=${sharedCtx.currentTime.toFixed(1)}s | LEVELS: ${summary}`)
  }
  const now = sharedCtx.currentTime
  const MAX_AHEAD = 0.2
  // Only reset on meaningful underrun (>20ms behind playback clock).
  // The 20ms grace window absorbs normal network jitter — a single late packet no
  // longer triggers a 100ms fresh-start gap that causes the motor/chop artefact.
  // Do NOT reset on overrun: new buffers would be scheduled while old ones are still
  // playing, creating amplitude-modulation motor noise. Overrun self-corrects once
  // packet delivery catches up with the queued playback.
  for (const pkt of packets) {
    const b = bridges.get(pkt.channel)
    if (b && b.nextPlayTime < now - 0.020) b.nextPlayTime = 0
  }
  const activeTimes = packets
    .map(pkt => bridges.get(pkt.channel)?.nextPlayTime ?? 0)
    .filter(t => t > now)
  const batchStart = activeTimes.length > 0
    ? Math.max(Math.max(...activeTimes), now + 0.003)  // seamless continuation
    : now + 0.040                                       // fresh start — reduced from 100ms
  for (const pkt of packets) handlePcmPacket(pkt, batchStart)
}

// Resume sharedCtx on any user gesture — AudioContext starts suspended on page load and
// getSharedCtx's resume() only runs during startChannelBridge. If both bridge setup runs
// finish before the user's first click, sharedCtx stays suspended and the stereo producer
// sends silence. This listener catches gestures that occur after setup is complete.
;(() => {
  const resumeShared = () => {
    if (sharedCtx) {
      const before = sharedCtx.state
      sharedCtx.resume().then(() => {
        if (before !== 'running')
          console.log(`[AudioBridge] sharedCtx resumed on gesture: ${before} → ${sharedCtx!.state}`)
      }).catch(() => {})
    }
  }
  document.addEventListener('click', resumeShared, { capture: true })
  document.addEventListener('keydown', resumeShared, { capture: true })
})()

function ensurePcmListener() {
  if (pcmListenerActive) return
  socket.on("audio:pcm:multi", handleMultiPcmPacket)
  document.addEventListener("visibilitychange", handleVisibility)
  pcmListenerActive = true
}

export async function startChannelBridge(channel: number, sampleRate: number): Promise<MediaStream> {
  stopChannelBridge(channel)
  ensurePcmListener()

  const ctx = await getSharedCtx(sampleRate)

  const gainNode = ctx.createGain()
  gainNode.gain.value = gainValues.get(channel) ?? 1.0
  gainNodes.set(channel, gainNode)

  const savedEQ = eqValues.get(channel) ?? { low: 0, mid: 0, high: 0 }

  const eqLow = ctx.createBiquadFilter()
  eqLow.type = 'lowshelf'; eqLow.frequency.value = 200; eqLow.gain.value = savedEQ.low
  eqFiltersLow.set(channel, eqLow)

  const eqMid = ctx.createBiquadFilter()
  eqMid.type = 'peaking'; eqMid.frequency.value = 1000; eqMid.Q.value = 0.7; eqMid.gain.value = savedEQ.mid
  eqFiltersMid.set(channel, eqMid)

  const eqHigh = ctx.createBiquadFilter()
  eqHigh.type = 'highshelf'; eqHigh.frequency.value = 5000; eqHigh.gain.value = savedEQ.high
  eqFiltersHigh.set(channel, eqHigh)

  const analyser = ctx.createAnalyser()
  analyser.fftSize = 1024
  analyser.smoothingTimeConstant = 0.3

  const gateNode = ctx.createGain()
  gateNode.gain.value = muteValues.get(channel) ? 0 : 1
  bridgeGateNodes.set(channel, gateNode)

  const panNode = ctx.createStereoPanner()
  panNode.pan.value = panValues.get(channel) ?? 0
  panNodes.set(channel, panNode)

  const destination = ctx.createMediaStreamDestination()

  // Chain: gainNode → eqLow → eqMid → eqHigh → analyser → gateNode → panNode → destination
  gainNode.connect(eqLow)
  eqLow.connect(eqMid)
  eqMid.connect(eqHigh)
  eqHigh.connect(analyser)
  analyser.connect(gateNode)
  gateNode.connect(panNode)
  panNode.connect(destination)

  const buf = new Float32Array(analyser.fftSize)
  let gateOpen: boolean | null = null  // null = first run, force initial set
  const tick = () => {
    analyser.getFloatTimeDomainData(buf)
    let sum = 0
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i]
    const rms = Math.sqrt(sum / buf.length)
    levelCallbacks.get(channel)?.(Math.min(100, rms * 400))

    const gate = gateSettings.get(channel)
    const muted = muteValues.get(channel) ?? false
    const shouldOpen = !muted && (!gate?.enabled || (rms > 0 ? 20 * Math.log10(rms) : -100) > gate.threshold)
    if (shouldOpen !== gateOpen) {
      gateNode.gain.setTargetAtTime(shouldOpen ? 1 : 0, ctx.currentTime, shouldOpen ? 0.010 : 0.005)
      gateOpen = shouldOpen
    }

    if (bridges.has(channel)) requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)

  const instance: BridgeInstance = {
    gainNode, eqLow, eqMid, eqHigh, analyser, gateNode, panNode,
    destination,
    stream: destination.stream,
    channel,
    nextPlayTime: 0
  }
  bridges.set(channel, instance)

  const track = destination.stream.getAudioTracks()[0]
  console.log(`🎙 Bridge ch${channel} started @ ${sampleRate}Hz (shared ctx), track: ${track?.readyState}`)

  return destination.stream
}

export function stopChannelBridge(channel: number) {
  const bridge = bridges.get(channel)
  if (!bridge) return
  try { bridge.gainNode.disconnect() } catch {}
  try { bridge.eqLow.disconnect() } catch {}
  try { bridge.eqMid.disconnect() } catch {}
  try { bridge.eqHigh.disconnect() } catch {}
  try { bridge.analyser.disconnect() } catch {}
  try { bridge.gateNode.disconnect() } catch {}
  try { bridge.panNode.disconnect() } catch {}
  try { bridge.destination.disconnect() } catch {}
  gainNodes.delete(channel)
  eqFiltersLow.delete(channel)
  eqFiltersMid.delete(channel)
  eqFiltersHigh.delete(channel)
  bridgeGateNodes.delete(channel)
  panNodes.delete(channel)
  bridges.delete(channel)
  console.log(`⏹ Bridge ch${channel} stopped`)
}

export function stopAllBridges() {
  for (const ch of [...bridges.keys()]) stopChannelBridge(ch)
  if (sharedCtx && sharedCtx.state !== 'closed') {
    sharedCtx.close().catch(() => {})
    sharedCtx = null
  }
  if (pcmListenerActive) {
    socket.off("audio:pcm:multi", handleMultiPcmPacket)
    document.removeEventListener("visibilitychange", handleVisibility)
    pcmListenerActive = false
  }
}

export function setChannelGain(channel: number, gain: number) {
  gainValues.set(channel, gain)
  const gainNode = gainNodes.get(channel)
  if (gainNode && sharedCtx) {
    gainNode.gain.setTargetAtTime(gain, sharedCtx.currentTime, 0.012)
    console.log(`[AudioBridge] setChannelGain ch${channel} → ${gain.toFixed(2)}`)
  }
}

export function setChannelEQ(channel: number, band: 'low' | 'mid' | 'high', db: number) {
  const saved = eqValues.get(channel) ?? { low: 0, mid: 0, high: 0 }
  eqValues.set(channel, { ...saved, [band]: db })
  const node = band === 'low' ? eqFiltersLow.get(channel)
             : band === 'mid' ? eqFiltersMid.get(channel)
             : eqFiltersHigh.get(channel)
  if (node && sharedCtx) node.gain.setTargetAtTime(db, sharedCtx.currentTime, 0.01)
}

export function setChannelGate(channel: number, enabled: boolean, threshold: number) {
  gateSettings.set(channel, { enabled, threshold })
}

export function setChannelMute(channel: number, muted: boolean) {
  muteValues.set(channel, muted)
  const gateNode = bridgeGateNodes.get(channel)
  if (gateNode && sharedCtx && muted) gateNode.gain.setTargetAtTime(0, sharedCtx.currentTime, 0.005)
}

export function setChannelPan(channel: number, pan: number) {
  panValues.set(channel, pan)
  const panNode = panNodes.get(channel)
  if (panNode && sharedCtx) {
    panNode.pan.setTargetAtTime(pan, sharedCtx.currentTime, 0.012)
    console.log(`[AudioBridge] setChannelPan ch${channel} → ${pan.toFixed(2)}`)
  }
}

;(window as any).__setChannelGain = setChannelGain
;(window as any).__setChannelPan = setChannelPan

export function setChannelLevelCallback(channel: number, cb: (level: number) => void) {
  levelCallbacks.set(channel, cb)
}

export function getChannelStream(channel: number): MediaStream | null {
  const bridge = bridges.get(channel)
  if (!bridge) return null
  const tracks = bridge.stream.getAudioTracks()
  return tracks.length > 0 && tracks[0].readyState === "live" ? bridge.stream : null
}

export function isChannelBridgeLive(channel: number): boolean {
  const bridge = bridges.get(channel)
  if (!bridge) return false
  const tracks = bridge.stream.getAudioTracks()
  return tracks.length > 0 && tracks[0].readyState === "live"
}

export function getActiveBridgeChannels(): number[] {
  return [...bridges.keys()].sort((a, b) => a - b)
}

/**
 * Merger to mono bridge-kanaler til én stereo MediaStream.
 */
export async function getStereoStream(chL: number, chR: number): Promise<MediaStream | null> {
  const gainL = gainNodes.get(chL)
  const gainR = gainNodes.get(chR)
  if (!gainL || !gainR || !sharedCtx) return null

  // Log context state — if suspended, audio path will be silent until user gesture
  console.log(`[AudioBridge] getStereoStream ch${chL}+${chR}: sharedCtx.state=${sharedCtx.state} currentTime=${sharedCtx.currentTime.toFixed(2)}`)
  if (sharedCtx.state !== 'running') {
    await sharedCtx.resume().catch(e => console.warn('[AudioBridge] sharedCtx.resume() failed in getStereoStream:', e))
    console.log(`[AudioBridge] sharedCtx state after resume attempt: ${sharedCtx.state}`)
  }

  const merger = sharedCtx.createChannelMerger(2)
  gainL.connect(merger, 0, 0)
  gainR.connect(merger, 0, 1)

  const dest = sharedCtx.createMediaStreamDestination()
  merger.connect(dest)

  const track = dest.stream.getAudioTracks()[0]
  if (!track || track.readyState !== 'live') return null

  console.log(`🎙 Stereo merge ch${chL}+ch${chR} → live (shared ctx)`)
  return dest.stream
}

// Backward-compat
export function startAudioBridge(sampleRate: number): Promise<MediaStream> {
  return startChannelBridge(1, sampleRate)
}
export function stopAudioBridge() { stopChannelBridge(1) }
export function isAudioBridgeLive(): boolean { return isChannelBridgeLive(1) }
export function getAudioBridgeStream(): MediaStream | null { return getChannelStream(1) }
export function isAudioBridgeActive(): boolean { return bridges.has(1) }
export function setAudioBridgeLevelCallback(cb: (level: number) => void) { setChannelLevelCallback(1, cb) }
