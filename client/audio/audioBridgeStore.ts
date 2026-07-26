/**
 * audioBridgeStore.ts – multi-kanal version
 * Styrer én bridge-instans per kanal.
 * Eksporterer kanal-specifik state og globalt antal kanaler.
 */

import { socket } from "../webrtc/intercom"
import { produceBridgeStream, produceStereoStream, isMediasoupReady, initMediasoup } from "../webrtc/mediasoupClient"
import {
  startChannelBridge, stopChannelBridge, stopAllBridges,
  setChannelLevelCallback, getChannelStream,
  isChannelBridgeLive, getActiveBridgeChannels, getStereoStream
} from "./AudioBridge"

type BridgeStatus = "idle" | "starting" | "active" | "error"

type ChannelState = {
  channel: number
  status: BridgeStatus
  level: number
  stream: MediaStream | null
  error: string | null
}

type ChannelInfo = { channel: number; name: string; type: "input" | "output" }

type GlobalBridgeState = {
  deviceIndex: number | null
  deviceName: string
  sampleRate: number
  totalChannels: number
  channels: ChannelState[]
  channelInfo: ChannelInfo[]
  error: string | null
}

const state: GlobalBridgeState = {
  deviceIndex: null,
  deviceName: "",
  sampleRate: 48000,
  totalChannels: 0,
  channels: [],
  channelInfo: [],
  error: null
}

const listeners = new Set<(s: GlobalBridgeState) => void>()

export function subscribeBridge(fn: (s: GlobalBridgeState) => void): () => void {
  listeners.add(fn)
  fn({ ...state })
  return () => listeners.delete(fn)
}

function notify() {
  listeners.forEach(fn => fn({ ...state }))
}

function channelState(ch: number): ChannelState {
  return state.channels.find(c => c.channel === ch) || {
    channel: ch, status: "idle", level: 0, stream: null, error: null
  }
}

function setChannelState(ch: number, updates: Partial<ChannelState>) {
  const idx = state.channels.findIndex(c => c.channel === ch)
  if (idx >= 0) {
    state.channels[idx] = { ...state.channels[idx], ...updates }
  } else {
    state.channels.push({ channel: ch, status: "idle", level: 0, stream: null, error: null, ...updates })
  }
  notify()
}

/* ---- START CAPTURE (alle kanaler) ---- */
let batchLevelInterval: ReturnType<typeof setInterval> | null = null

function startBatchLevelReporting() {
  if (batchLevelInterval) clearInterval(batchLevelInterval)
  batchLevelInterval = setInterval(() => {
    const levels: Record<string, number> = {}
    for (const ch of state.channels) {
      if (ch.status === "active") {
        levels[`bridge-ch${ch.channel}`] = ch.level > 0.5 ? ch.level : 0
      }
    }
    
    if (Object.keys(levels).length > 0) {
      socket.emit("bridge:levels", levels)
    }
  }, 30) // ~33 gange/sek – hurtigere meter respons
}

export function stopBatchLevelReporting() {
  if (batchLevelInterval) { clearInterval(batchLevelInterval); batchLevelInterval = null }
}

export async function startBridgeCapture(deviceIndex: number, deviceName: string, sampleRate = 48000): Promise<void> {
  state.deviceIndex = deviceIndex
  state.deviceName = deviceName
  state.sampleRate = sampleRate
  state.error = null
  notify()

  return new Promise((resolve, reject) => {
    socket.emit("audio:capture:start", { deviceIndex, deviceName, sampleRate }, async (res: any) => {
      if (!res?.ok) {
        state.error = res?.error || "Capture fejlede"
        notify()
        reject(new Error(state.error || "unknown"))
        return
      }

      const totalChannels: number = res.totalChannels || 2
      state.totalChannels = totalChannels
      state.channelInfo = res.channelInfo || []
      console.log(`🎛️  Bridge: ${totalChannels} kanaler på device ${deviceIndex}`)
      // 🔥 Send kanal-info til server så ConnectionsPopup kan hente det
      socket.emit("audio:bridge:channelInfo:set", res.channelInfo || [])

      // Initialiser channel states
      state.channels = Array.from({ length: totalChannels }, (_, i) => ({
        channel: i + 1, status: "starting" as BridgeStatus, level: 0, stream: null, error: null
      }))
      notify()

      // Start én bridge pr. kanal
      for (let ch = 1; ch <= totalChannels; ch++) {
        try {
          setChannelLevelCallback(ch, (level) => {
            setChannelState(ch, { level })
            // Niveauer batches og sendes samlet – se batchBridgeLevels nedenfor
          })
          const stream = await startChannelBridge(ch, sampleRate)
          setChannelState(ch, { status: "active", stream })
          console.log(`✅ Bridge ch${ch} aktiv`)

          // 🔥 Producér bridge-stream via WebRTC – vent på mediasoup er klar
          try {
            // Poll indtil mediasoup er initialiseret (max 30 sekunder)
            let waited = 0
            while (!isMediasoupReady() && waited < 30000) {
              await new Promise(r => setTimeout(r, 500))
              waited += 500
            }
            if (!isMediasoupReady()) {
              await initMediasoup()
            }
            const producerId = await produceBridgeStream(stream, ch)
            // Registrér via batch-event (undgår 30x broadcastRouting)
            socket.emit("bridge:producer:register", { channel: ch, producerId })
            console.log(`✅ Bridge ch${ch} WebRTC producer: ${producerId}`)
          } catch (e) {
            console.error(`❌ Bridge ch${ch} WebRTC produce fejlede:`, e)
          }
        } catch (e: any) {
          setChannelState(ch, { status: "error", error: e.message })
          console.error(`❌ Bridge ch${ch} fejlede:`, e)
        }
      }

      // 🔥 Produce stereo pairs for consecutive channel pairs (1+2, 3+4, …)
      const activeChs = getActiveBridgeChannels()
      for (let i = 0; i < activeChs.length - 1; i += 2) {
        const chL = activeChs[i]
        const chR = activeChs[i + 1]
        try {
          const stereoStream = await getStereoStream(chL, chR)
          if (stereoStream) {
            const producerId = await produceStereoStream(stereoStream, chL, chR)
            socket.emit("bridge:stereo:register", { chL, chR, producerId })
            console.log(`✅ Stereo bridge ch${chL}+${chR}: ${producerId}`)
          }
        } catch (e) {
          console.error(`❌ Stereo bridge ch${chL}+${chR} fejlede:`, e)
        }
      }

      // Signal AFTER stereo producers are registered so routing broadcasts include them
      socket.emit("bridge:producers:done")

      // 🔥 Start batched level reporting – ÉT event per 50ms for ALLE kanaler samlet
      startBatchLevelReporting()

      resolve()
    })
  })
}

/* ---- STOP CAPTURE ---- */
export function stopBridgeCapture() {
  socket.emit("audio:capture:stop", () => {})
  stopAllBridges()
  state.channels.forEach(c => { c.status = "idle"; c.stream = null; c.level = 0 })
  state.totalChannels = 0
  notify()
}

/* ---- GETTERS ---- */
export function getBridgeStream(channel = 1): MediaStream | null {
  return getChannelStream(channel)
}

export function getBridgeLevel(channel = 1): number {
  return channelState(channel).level
}

export function isBridgeLive(channel = 1): boolean {
  return isChannelBridgeLive(channel)
}

export function getBridgeChannelCount(): number {
  return state.totalChannels
}

export function getActiveBridgeChannelList(): number[] {
  return getActiveBridgeChannels()
}

// Bagudkompatibilitet
export function getBridgeStream1(): MediaStream | null { return getBridgeStream(1) }