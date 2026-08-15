import { Device } from "mediasoup-client"
import { socket } from "./intercom"

let device: Device
let sendTransport: any
let recvTransport: any
let _initialized = false
let _initializing = false

export function isMediasoupReady(): boolean {
  return _initialized && !!sendTransport
}

export async function initMediasoup() {
  if (_initialized) return
  if (_initializing) {
    await new Promise<void>(resolve => {
      const check = setInterval(() => {
        if (_initialized) { clearInterval(check); resolve() }
      }, 100)
    })
    return
  }

  _initializing = true

  try {
    if (!socket.connected) {
      await new Promise<void>(resolve => {
        socket.once("connect", resolve)
      })
    }

    const routerRtpCapabilities = await new Promise<any>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("getRouterRtpCapabilities timeout")), 8000)
      socket.emit("mediasoup:getRouterRtpCapabilities", (caps: any) => {
        clearTimeout(timeout)
        resolve(caps)
      })
    })

    device = new Device()
    await device.load({ routerRtpCapabilities })

    /* SEND TRANSPORT */
    const sendParams = await new Promise<any>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("createSendTransport timeout")), 8000)
      socket.emit("mediasoup:createTransport", { direction: "send" }, (params: any) => {
        clearTimeout(timeout)
        resolve(params)
      })
    })

    sendTransport = device.createSendTransport(sendParams)

    sendTransport.on("connect", ({ dtlsParameters }: any, cb: () => void) => {
      socket.emit("mediasoup:connectTransport", { transportId: sendTransport.id, dtlsParameters }, cb)
    })

    sendTransport.on("produce", ({ kind, rtpParameters }: any, cb: (p: { id: string }) => void) => {
      socket.emit("mediasoup:produce", { transportId: sendTransport.id, kind, rtpParameters },
        ({ id }: { id: string }) => cb({ id }))
    })

    sendTransport.on("connectionstatechange", (state: string) => {
      console.warn(`[mediasoup] sendTransport connectionstatechange: ${state}`)
      if (state === "failed" || state === "disconnected") {
        console.error("[mediasoup] ⚠️  sendTransport dropped — genbrug bridge eller reload siden")
      }
    })

    /* RECV TRANSPORT */
    const recvParams = await new Promise<any>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("createRecvTransport timeout")), 8000)
      socket.emit("mediasoup:createTransport", { direction: "recv" }, (params: any) => {
        clearTimeout(timeout)
        resolve(params)
      })
    })

    recvTransport = device.createRecvTransport(recvParams)

    recvTransport.on("connect", ({ dtlsParameters }: any, cb: () => void) => {
      socket.emit("mediasoup:connectTransport", { transportId: recvTransport.id, dtlsParameters }, cb)
    })

    recvTransport.on("connectionstatechange", (state: string) => {
      console.warn(`[mediasoup] recvTransport connectionstatechange: ${state}`)
    })

    _initialized = true
    console.log("✅ Mediasoup client initialized")

  } finally {
    _initializing = false
  }
}

/* ---------- PRODUCE STREAM ---------- */

let currentProducer: any = null
let _produceLock = false  // prevents concurrent produceStream calls from cycling producers
const bridgeProducers = new Map<number, any>() // channel → producer

export async function produceBridgeStream(stream: MediaStream, channel: number): Promise<string> {
  if (!sendTransport) await initMediasoup()
  if (!sendTransport) throw new Error("sendTransport not ready")

  const track = stream.getAudioTracks()[0]
  if (!track) throw new Error(`no audio track for bridge ch${channel}`)
  if (track.readyState === "ended") throw new Error(`track ended for bridge ch${channel}`)

  // Use track directly – cloning breaks GainNode control

  // Luk evt. eksisterende bridge producer for denne kanal
  const old = bridgeProducers.get(channel)
  if (old) { try { old.close() } catch {} }

  const producer = await sendTransport.produce({
    track,
    encodings: [{ maxBitrate: 128000 }],
    codecOptions: { opusFec: true, opusDtx: true, opusMaxPlaybackRate: 48000 }
  })
  bridgeProducers.set(channel, producer)
  console.log(`✅ Bridge ch${channel} producing: ${producer.id}`)
  return producer.id
}

export async function produceStereoStream(stream: MediaStream, chL: number, chR: number): Promise<string> {
  if (!sendTransport) await initMediasoup()
  if (!sendTransport) throw new Error("sendTransport not ready")
  const track = stream.getAudioTracks()[0]
  if (!track) throw new Error(`no stereo track for ch${chL}+${chR}`)
  if (track.readyState === "ended") throw new Error(`stereo track ended for ch${chL}+${chR}`)
  const key = chL * 1000 + chR
  const old = bridgeProducers.get(key)
  if (old) { try { old.close() } catch {} }
  const producer = await sendTransport.produce({
    track,
    encodings: [{ maxBitrate: 256000 }],
    codecOptions: { opusStereo: true, opusFec: true, opusDtx: false, opusMaxPlaybackRate: 48000 }
  })
  bridgeProducers.set(key, producer)
  console.log(`✅ Stereo bridge ch${chL}+${chR} producing: ${producer.id}`)
  return producer.id
}

export async function produceStream(stream: MediaStream): Promise<void> {
  // Prevent concurrent calls — a second call while the first is in-flight would close the
  // just-created producer (cycling), which breaks IFB consumers on remote clients.
  if (_produceLock) {
    console.log("[produceStream] in-flight — skipping concurrent call")
    return
  }
  // Skip if already producing a live track — prevents cycling from repeated startMic calls
  // which would close + reopen the producer and break the phone's IFB consumer.
  if (currentProducer && !currentProducer.closed) {
    console.log("[produceStream] already producing — skipping")
    return
  }
  _produceLock = true

  try {
    if (!sendTransport) {
      console.log("produceStream: initializing transport first...")
      await initMediasoup()
    }

    if (!sendTransport) {
      throw new Error("sendTransport not ready after init")
    }

    const tracks = stream.getAudioTracks()
    if (tracks.length === 0) throw new Error("no audio tracks in stream")

    const track = tracks[0]
    if (track.readyState === "ended") throw new Error(`audio track ended`)

    const clonedTrack = track.clone()
    if (clonedTrack.readyState !== "live") {
      clonedTrack.stop()
      throw new Error(`cloned track not live: ${clonedTrack.readyState}`)
    }

    if (currentProducer) {
      currentProducer.close()
      currentProducer = null
    }

    currentProducer = await sendTransport.produce({ track: clonedTrack })
    console.log("✅ Producing audio:", currentProducer.id)

    socket.emit("producer:register", {
      clientId: getClientId(),
      producerId: currentProducer.id
    })
  } finally {
    _produceLock = false
  }
}

export async function stopProducing() {
  _produceLock = false  // allow a fresh produceStream call after stop
  if (currentProducer) {
    const pid = currentProducer.id
    try { currentProducer.close() } catch {}
    currentProducer = null
    import('./intercom').then(({ socket }) => {
      socket.emit('producer:closed', { clientId: getClientId(), producerId: pid })
    }).catch(() => {})
  }
}

/* ---------- VIDEO PRODUCE ---------- */

const videoProducersByChannel = new Map<number, any>()
const videoAudioProducers = new Map<number, any>()

export async function produceVideoStream(stream: MediaStream, channel?: number): Promise<{ videoId: string; audioId: string | null }> {
  if (!sendTransport) throw new Error("sendTransport not ready")
  const videoTrack = stream.getVideoTracks()[0]
  if (!videoTrack) throw new Error("no video track")
  const cloned = videoTrack.clone()
  let codecOptions: any = { videoGoogleStartBitrate: 2000 }
  let codec: any = undefined
  try {
    const routerCodecs = (sendTransport as any).handler?.router?.rtpCapabilities?.codecs
    const h264 = routerCodecs?.find((c: any) => c.mimeType?.toLowerCase() === 'video/h264')
    if (h264) { codec = h264 }
  } catch {}
  const producer = await sendTransport.produce({
    track: cloned,
    encodings: [{ maxBitrate: 3000000 }],
    codecOptions,
    ...(codec ? { codec } : {})
  })
  if (channel !== undefined) videoProducersByChannel.set(channel, producer)
  let audioId: string | null = null
  const audioTrack = stream.getAudioTracks()[0]
  if (audioTrack && channel !== undefined) {
    try {
      const audioCloned = audioTrack.clone()
      const audioProducer = await sendTransport.produce({
        track: audioCloned,
        codecOptions: { opusFec: true, opusDtx: true, opusMaxPlaybackRate: 48000 }
      })
      videoAudioProducers.set(channel, audioProducer)
      audioId = audioProducer.id
    } catch {}
  }
  return { videoId: producer.id, audioId }
}

export function closeVideoProducer(channel: number) {
  const vp = videoProducersByChannel.get(channel)
  if (vp) { try { vp.close() } catch {} videoProducersByChannel.delete(channel) }
  const ap = videoAudioProducers.get(channel)
  if (ap) { try { ap.close() } catch {} videoAudioProducers.delete(channel) }
}

/* ---------- GETTERS ---------- */

let _clientId = ""
export function setClientId(id: string) { _clientId = id }
export function getClientId() { return _clientId }

export function getDevice() { return device }
export function getSendTransport() { return sendTransport }
export function getRecvTransport() { return recvTransport }
