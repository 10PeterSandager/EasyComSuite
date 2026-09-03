// webrtc/intercom.ts – React Native version
import { io, Socket } from 'socket.io-client'
import InCallManager from 'react-native-incall-manager'
import { NativeEventEmitter, NativeModules } from 'react-native'
import {
  MediaStream,
  mediaDevices,
  registerGlobals,
} from 'react-native-webrtc'

registerGlobals()

// ─── Audio session ─────────────────────────────────────────────────────────
let _routeChangeListener: any = null
let _routeChangeTimer: ReturnType<typeof setTimeout> | null = null

export function startAudioSession() {
  const { EasyComAudio } = NativeModules
  console.log('[audio] startAudioSession — EasyComAudio module:', EasyComAudio ? 'loaded' : 'MISSING', 'configureForStereo:', EasyComAudio?.configureForStereo ? 'available' : 'MISSING')

  // media:'audio' (not 'video') is critical:
  // With media:'video', InCallManager's route-change observer calls updateAudioRoute()
  // on every CategoryChange, which re-asserts VideoChat mode and wins over our A2DP config.
  // With media:'audio', updateAudioRoute() leaves audioMode empty and never re-asserts
  // any mode — so EasyComAudio's Default+A2DP config stays in effect after AirPods connect.
  InCallManager.start({ media: 'audio' })
  console.log('[audio] InCallManager started (audio mode — no VideoChat override)')

  if (EasyComAudio?.configureForStereo) {
    EasyComAudio.configureForStereo()
    console.log('[audio] session configured (Default/A2DP+BT)')
  }

  // When AirPods connect, WebRTC restarts its audio unit internally. Without muting
  // tracks during this window, the jitter buffer overfills → time-scaling → slow audio.
  if (EasyComAudio && !_routeChangeListener) {
    const emitter = new NativeEventEmitter(EasyComAudio)
    _routeChangeListener = emitter.addListener('EasyComAudioRouteChange', ({ reason }: { reason: string }) => {
      console.log('[audio] route change:', reason)
      if (_routeChangeTimer) { clearTimeout(_routeChangeTimer); _routeChangeTimer = null }
      for (const consumer of _consumers.values()) {
        try { if (consumer.track) consumer.track.enabled = false } catch {}
      }
      _routeChangeTimer = setTimeout(() => {
        _routeChangeTimer = null
        const routedSources = new Set(Object.values(_currentRouting).flat())
        for (const [srcId, consumer] of _consumers.entries()) {
          if (routedSources.has(srcId)) {
            try { if (consumer.track) consumer.track.enabled = true } catch {}
          }
        }
        console.log('[audio] tracks re-enabled after route change')
      }, 800)
    })
  }
}

export function stopAudio() {
  _routeChangeListener?.remove()
  _routeChangeListener = null
  if (_routeChangeTimer) { clearTimeout(_routeChangeTimer); _routeChangeTimer = null }
  InCallManager.stop()
}

// ─── URL builder ────────────────────────────────────────────────────────────
// Local IPs → http on port 3001 (LAN, no SSL), everything else → https on port 3000.
export function buildServerUrl(host: string, ssl = false): string {
  const h = host.trim()
  if (/^https?:\/\//i.test(h)) return h.replace(/\/$/, '')
  const proto = ssl ? 'https' : 'http'
  const hasPort = /:\d+$/.test(h)
  const port = hasPort ? '' : (ssl ? ':3000' : ':3001')
  return `${proto}://${h}${port}`
}

// ─── Socket ────────────────────────────────────────────────────────────────
let _socket: Socket | null = null
let _channelNames: Record<number, string> = {}
let _channelNameCb: ((n: Record<number, string>) => void) | null = null
let _clientName = ''
let _clientCode = ''

export function getSocket(): Socket | null { return _socket }
export function getChannelNames() { return _channelNames }
export function onChannelNames(cb: (n: Record<number, string>) => void) { _channelNameCb = cb }

let _connectedUrl = ''

export async function connectSocket(hostIp: string, sessionPassword = '', ssl = false): Promise<Socket> {
  const url = buildServerUrl(hostIp, ssl)
  // Reuse existing connected socket only if it's for the same URL
  if (_socket?.connected && _connectedUrl === url) return _socket
  if (_socket) { _socket.removeAllListeners(); _socket.disconnect(); _socket = null }

  return new Promise((resolve, reject) => {
    console.log('[intercom] connecting to', url)

    const s = io(url, {
      path: '/io',
      transports: ['websocket'],
      timeout: 10000,
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 4000,
      auth: { sessionPassword },
    })

    const t = setTimeout(() => { s.disconnect(); reject(new Error(`Timeout: ${url}`)) }, 10000)

    s.once('connect', () => {
      clearTimeout(t)
      console.log('[intercom] ✅ connected')
      _socket = s
      _connectedUrl = url

      s.on('channel:names:push', (names: Record<number, string>) => {
        _channelNames = names; _channelNameCb?.(names)
      })
      s.on('kicked', () => { _channelNames = {} })
      s.on('video:producer:available', ({ clientId, producerId }: { clientId: string; producerId: string }) => {
        onVideoProducerAvailable(clientId, producerId)
      })
      s.on('video:routing:update', ({ videoSources }: { videoSources: number[] }) => {
        setVideoRouting(videoSources)
      })
      s.on('audio:levels', (levels: Record<string, number>) => {
        for (const [k, v] of Object.entries(levels)) {
          _audioLevels[`recv_${k}`] = v
        }
        _levelListeners.forEach(fn => fn({ ..._audioLevels }))
      })

      // Decay meter to 0 if no update arrives — prevents hanging meters
      setInterval(() => {
        let changed = false
        for (const k of Object.keys(_audioLevels)) {
          if (_audioLevels[k] > 0) { _audioLevels[k] = Math.max(0, _audioLevels[k] - 8); changed = true }
        }
        if (changed) _levelListeners.forEach(fn => fn({ ..._audioLevels }))
      }, 80)

      // Re-register on every subsequent reconnect (socket.io auto-reconnects but
      // the server deletes the client entry on disconnect, so we must re-register).
      // Also reinit mediasoup transports — the server creates a fresh router on restart,
      // so any existing transport IDs are unknown to the new instance.
      s.on('connect', () => {
        if (!_clientId) return
        console.log('[intercom] 🔄 reconnected – re-registering', _clientId)
        s.emit('client:register',
          { id: _clientId, name: _clientName, type: 'mobile', code: _clientCode },
          async () => {
            console.log('[intercom] ✅ re-registered after reconnect')
            await reinitTransports().catch(e => console.warn('[intercom] transport reinit failed:', e))
            setTimeout(() => {
              s.emit('routing:request:all')
              // Request current video producers so onProducerReady can trigger re-consume
              if (_clientId) s.emit('video:producers:request', { clientId: _clientId }, () => {})
            }, 300)
          }
        )
      })

      resolve(s)
    })
    s.once('connect_error', (err) => {
      clearTimeout(t); s.disconnect()
      reject(new Error(`Connection error: ${err.message}`))
    })
  })
}

// ─── Client list + auth ────────────────────────────────────────────────────
export async function fetchClients(hostIp: string, sessionPassword = '', ssl = false): Promise<any[]> {
  const s = await connectSocket(hostIp, sessionPassword, ssl)
  return new Promise((resolve, reject) => {
    s.emit('clients:list', (clients: any[]) => {
      if (!Array.isArray(clients)) return reject(new Error('Invalid response'))
      resolve(clients.filter(c =>
        c.id !== 'host-ui' && c.id !== 'producer-65' && !c.id.startsWith('bridge-') &&
        c.type === 'mobile' && !c.connected
      ))
    })
    setTimeout(() => reject(new Error('Timeout')), 4000)
  })
}

export async function fetchAllClients(): Promise<any[]> {
  if (!_socket) return []
  return new Promise(resolve => {
    _socket!.emit('clients:list', (clients: any[]) => {
      if (!Array.isArray(clients)) return resolve([])
      resolve(clients.filter(c => c.id !== 'host-ui' && c.id !== 'producer-65' && c.status === 'online'))
    })
    setTimeout(() => resolve([]), 3000)
  })
}

export async function validatePin(clientId: string, code: string): Promise<boolean> {
  if (!_socket) return false
  return new Promise(resolve => {
    _socket!.emit('client:auth', { clientId, code }, (r: any) => resolve(r?.ok === true))
    setTimeout(() => resolve(false), 3000)
  })
}

// ─── Audio levels ──────────────────────────────────────────────────────────
let _audioLevels: Record<string, number> = {}
type LevelListener = (levels: Record<string, number>) => void
const _levelListeners = new Set<LevelListener>()

export function subscribeToLevels(fn: LevelListener): () => void {
  _levelListeners.add(fn); fn({ ..._audioLevels })
  return () => _levelListeners.delete(fn)
}

export function resetLevel(key: string) {
  _audioLevels[key] = 0
  _levelListeners.forEach(fn => fn({ ..._audioLevels }))
}

// ─── Channel routing ───────────────────────────────────────────────────────
let _currentRouting: Record<number, string[]> = {}
export function getChannelRouting() { return _currentRouting }

// Apply gain locally to all consumer tracks routed to a channel.
// react-native-webrtc supports track._setVolume(0..1) for per-track volume.
// gain=0 also disables the track entirely so the engine stops rendering it.
export function setLocalChannelGain(channel: number, gain: number) {
  const sources = _currentRouting[channel] ?? []
  for (const srcId of sources) {
    const consumer = _consumers.get(srcId)
    const track = consumer?.track
    if (!track) continue
    try {
      if (gain === 0) {
        track.enabled = false
        track._setVolume?.(0)
      } else {
        track.enabled = true
        track._setVolume?.(gain)
      }
    } catch {}
  }
  console.log(`[intercom] setLocalChannelGain ch${channel} → ${(gain*100).toFixed(0)}%`)
}

// ─── Mediasoup ─────────────────────────────────────────────────────────────
let _device:        any | null = null
let _sendTransport: any | null = null
let _recvTransport: any | null = null
let _micProducer:   any | null = null
let _micStream:     any | null = null  // stored so transports can be recreated on reconnect
let _clientId = ''
let _levelInterval: ReturnType<typeof setInterval> | null = null

export async function initMediasoup(clientId: string, clientName = '', clientCode = ''): Promise<void> {
  _clientId = clientId
  _clientName = clientName
  _clientCode = clientCode
  const s = _socket!
  console.log('[mediasoup] loading device...')

  const { Device } = await import('mediasoup-client')

  try {
    const handlers = require('mediasoup-client').detectDevice()
    console.log('[mediasoup] auto-detected handler:', handlers)
  } catch {}

  const routerRtpCapabilities = await new Promise<any>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('rtpCapabilities timeout')), 8000)
    s.emit('mediasoup:getRouterRtpCapabilities', (caps: any) => { clearTimeout(t); resolve(caps) })
  })

  // Use handlerName string – no import needed, mediasoup resolves internally
  try {
    _device = new Device({ handlerName: 'ReactNative106' })
    console.log('[mediasoup] using ReactNative handler')
  } catch (e) {
    console.warn('[mediasoup] ReactNative handler not available, using auto-detect:', e)
    _device = new Device()
  }

  await _device.load({ routerRtpCapabilities })
  console.log('[mediasoup] ✅ device loaded, handler:', _device.handlerName)

  _sendTransport = await _createTransport('send')
  _recvTransport = await _createTransport('recv')

  console.log('[mediasoup] ✅ transports ready')
}

// Called on every socket reconnect to replace stale transports from the previous server instance.
export async function reinitTransports(): Promise<void> {
  if (!_socket || !_device) return
  console.log('[mediasoup] 🔄 reinitializing transports...')

  try { _sendTransport?.close() } catch {}
  try { _recvTransport?.close() } catch {}
  _sendTransport = null
  _recvTransport = null

  // All consumers belong to the old transport — drop them
  for (const [srcId, c] of _consumers.entries()) {
    try { c.close() } catch {}
    _stopTrack(srcId)
  }
  _consumers.clear()
  _failedConsumers.clear()
  _consuming.clear()

  // Drop video slots (stale consumers on dead transport)
  for (const slot of Array.from(_videoSlots.keys())) stopVideoSlot(slot)
  _availableVideoProducers.clear()

  _sendTransport = await _createTransport('send')
  _recvTransport = await _createTransport('recv')
  console.log('[mediasoup] ✅ transports reinitialized')

  if (_micStream) {
    await startMicProducer(_micStream).catch(e => console.warn('[mediasoup] mic reinit failed:', e))
  }
}

async function _createTransport(direction: 'send' | 'recv'): Promise<any> {
  const s = _socket!
  const params = await new Promise<any>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${direction} transport timeout`)), 8000)
    s.emit('mediasoup:createTransport', { direction }, (p: any) => { clearTimeout(t); resolve(p) })
  })

  if (!params || params.error) throw new Error(`transport:create failed: ${params?.error}`)

  const transport = direction === 'send'
    ? _device.createSendTransport(params)
    : _device.createRecvTransport(params)

  transport.on('connect', ({ dtlsParameters }: any, cb: () => void) => {
    s.emit('mediasoup:connectTransport', { transportId: transport.id, dtlsParameters }, cb)
  })

  transport.on('connectionstatechange', async (state: string) => {
    console.log(`[transport] ${direction} ICE state: ${state}`)
    if (state === 'failed') {
      console.warn(`[transport] ${direction} ICE FAILED — attempting ICE restart`)
      // Do NOT call InCallManager.start() here — it forces VoiceProcessingIO (mono)
      // and overrides the stereo AVAudioSession configuration.
      try {
        const result = await new Promise<any>((resolve, reject) => {
          const t = setTimeout(() => reject(new Error('restartIce timeout')), 5000)
          s.emit('mediasoup:restartIce', { transportId: transport.id }, (r: any) => {
            clearTimeout(t)
            resolve(r)
          })
        })
        if (result?.error) throw new Error(result.error)
        await transport.restartIce({ iceParameters: result.iceParameters })
        console.log(`[transport] ${direction} ICE restart requested — waiting for reconnect`)
      } catch (e) {
        console.error(`[transport] ${direction} ICE restart failed:`, e)
      }
    }
  })

  if (direction === 'send') {
    transport.on('produce', (
      { kind, rtpParameters }: any,
      cb: (p: { id: string }) => void,
    ) => {
      s.emit('mediasoup:produce', {
        transportId: transport.id, kind, rtpParameters,
      }, ({ id }: { id: string }) => {
        cb({ id })
        // Register producer with correct producerId
        setTimeout(() => s.emit('producer:register', { clientId: _clientId, producerId: id, kind }), 200)
      })
    })
  }

  return transport
}

// ─── Microphone ────────────────────────────────────────────────────────────
export async function getLocalAudioStream(): Promise<MediaStream> {
  const stream = await mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } as any,
    video: false,
  })
  return stream as unknown as MediaStream
}

export async function startMicProducer(micStream: MediaStream): Promise<void> {
  _micStream = micStream
  if (!_sendTransport) { console.warn('[mic] send transport not ready'); return }
  try {
    const track = (micStream.getAudioTracks() as any[])[0]
    if (!track) throw new Error('No audio track')
    _micProducer = await _sendTransport.produce({
      track,
      codecOptions: {
        opusStereo:          false,
        opusFec:             true,
        opusMaxPlaybackRate: 48000,
      },
    })
    // Pause on the server side immediately so no RTP flows until talk is pressed.
    // track.enabled = false alone doesn't stop the native audio pipeline in RN.
    track.enabled = false
    try { await (_micProducer as any).pause() } catch {}
    console.log('[mic] ✅ producing (paused until talk button pressed)')
  } catch (e) {
    console.warn('[mic] produce failed:', e)
  }
}

export function setMicActive(active: boolean) {
  if (!_micProducer) { console.warn('[mic] setMicActive called but no producer'); return }
  const track = _micProducer.track as any
  if (track) track.enabled = active
  try {
    if (active) {
      _micProducer.resume()
      console.log(`[mic] ▶ RESUMED | paused=${_micProducer.paused} track.enabled=${track?.enabled} readyState=${track?.readyState} producerId=${_micProducer.id}`)
      if (!_levelInterval) {
        _levelInterval = setInterval(() => {
          if (_socket && _clientId) _socket.emit('audio:level', { clientId: _clientId, level: 70 })
        }, 100)
      }
    } else {
      _micProducer.pause()
      console.log('[mic] ⏸ paused')
      if (_levelInterval) { clearInterval(_levelInterval); _levelInterval = null }
      if (_socket && _clientId) _socket.emit('audio:level', { clientId: _clientId, level: 0 })
    }
  } catch (e) {
    console.warn('[mic] pause/resume error:', e)
    if (_levelInterval) { clearInterval(_levelInterval); _levelInterval = null }
  }
}

// ─── Audio receive ─────────────────────────────────────────────────────────
// react-native-webrtc 124.x: remote audio tracks play automatically through
// the native engine when InCallManager is active with media:'video'.
// Keep a MediaStream reference to prevent GC.
// Audio levels come from server-pushed 'audio:levels' events — no client-side getStats needed.
const _activeStreams = new Map<string, MediaStream>()

// Callback so IntercomScreen can attach streams to RTCView for audio activation
let _onStreamAdded:   ((stream: MediaStream, sourceId: string) => void) | null = null
let _onStreamRemoved: ((stream: MediaStream) => void) | null = null
export function onStreamAdded(cb: (stream: MediaStream, sourceId: string) => void) {
  _onStreamAdded = cb
}
export function onStreamRemoved(cb: (stream: MediaStream) => void) {
  _onStreamRemoved = cb
}

function _playTrack(track: any, sourceId: string) {
  _stopTrack(sourceId)
  track.enabled = true
  const stream = new MediaStream([track])
  _activeStreams.set(sourceId, stream)
  _onStreamAdded?.(stream, sourceId)
  console.log(`[audio] track src="${sourceId}" enabled=${track.enabled} state=${track.readyState}`)
}

function _stopTrack(sourceId: string) {
  const stream = _activeStreams.get(sourceId)
  _activeStreams.delete(sourceId)
  if (stream) _onStreamRemoved?.(stream)
  resetLevel(`recv_${sourceId}`)
}

export function getActiveStreams() {
  return _activeStreams
}

// ─── IFB duck state ────────────────────────────────────────────────────────
type IFBChannelSettings = { muted: boolean; duckAmount: number }
let _ifbActive   = false
let _ifbSettings: Record<number, IFBChannelSettings> = {}

function _applyIFBGains() {
  for (const [chStr, ch] of Object.entries(_ifbSettings)) {
    const gain = ch.muted ? 0 : (100 - ch.duckAmount) / 100
    setLocalChannelGain(Number(chStr), gain)
  }
}

// active=true  → duck channels per settings  (duckAmount 0..100 = reduction %)
// active=false → restore previously ducked channels to full gain
export function applyIFBDuck(active: boolean, settings?: Record<number, IFBChannelSettings>) {
  const prev = _ifbSettings
  _ifbActive   = active
  _ifbSettings = settings ?? {}
  if (!active) {
    for (const chStr of Object.keys(prev)) setLocalChannelGain(Number(chStr), 1.0)
    return
  }
  _applyIFBGains()
}

// ─── Consumers ─────────────────────────────────────────────────────────────
const _consumers       = new Map<string, any>()
const _failedConsumers = new Set<string>()
const _consuming       = new Set<string>()


async function _consume(sourceId: string, channel: number, muteIfUnrouted = false) {
  if (_consumers.has(sourceId))       return
  if (_failedConsumers.has(sourceId)) return
  if (_consuming.has(sourceId))       return
  if (!_device || !_recvTransport) {
    console.warn(`[consume] not ready – retry 2s "${sourceId}"`)
    setTimeout(() => _consume(sourceId, channel, muteIfUnrouted), 2000)
    return
  }

  _consuming.add(sourceId)
  try {
    // react-native-webrtc does not include stereo=1 in its Opus SDP by default.
    // Without it, mediasoup creates a mono consumer even for stereo producers.
    // Patch the capabilities to declare stereo support before sending to server.
    const rtpCaps = JSON.parse(JSON.stringify(_device.rtpCapabilities))
    const opusCodec = rtpCaps.codecs?.find((c: any) =>
      c.mimeType?.toLowerCase() === 'audio/opus'
    )
    if (opusCodec) {
      opusCodec.parameters = { ...(opusCodec.parameters ?? {}), stereo: 1, 'sprop-stereo': 1 }
    }

    const result = await new Promise<any>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('timeout')), 8000)
      _socket!.emit('consume:request', {
        targetId:        sourceId,
        rtpCapabilities: rtpCaps,
        transportId:     _recvTransport.id,
      }, (res: any) => { clearTimeout(t); resolve(res) })
    })

    if (!result || result.error) {
      console.warn(`[consume] ❌ "${sourceId}": ${result?.error}`)
      _failedConsumers.add(sourceId); return
    }

    const { id, producerId, kind, rtpParameters } = result
    if (!id || !producerId || !rtpParameters) return

    const consumer = await _recvTransport.consume({ id, producerId, kind, rtpParameters })
    if (consumer.resume) await consumer.resume()

    _consumers.set(sourceId, consumer)
    _playTrack(consumer.track, sourceId)

    if (muteIfUnrouted) {
      const isRouted = Object.values(_currentRouting).flat().includes(sourceId)
      if (!isRouted) {
        try { consumer.track.enabled = false } catch {}
      }
    }

    console.log(`[consume] ✅ "${sourceId}" → ch${channel} | track: ${consumer.track.readyState}`)
  } catch (e) {
    console.error(`[consume] ❌ "${sourceId}":`, e)
    _failedConsumers.add(sourceId)
  } finally {
    _consuming.delete(sourceId)
  }
}

// ─── Routing ───────────────────────────────────────────────────────────────
let _routingInit = false

export function initRouting(clientId: string) {
  const s = _socket!
  console.log(`[routing] init for "${clientId}"`)
  if (_routingInit) { s.off('routing:update'); s.off('producer:closed'); s.off('producer:ready') }
  _routingInit = true

  s.on('producer:closed', ({ clientId: srcId }: { clientId: string }) => {
    const c = _consumers.get(srcId)
    if (c) {
      try { if (c.track) c.track.enabled = false } catch {}
      try { c.close() } catch {}
      _consumers.delete(srcId)
    }
    _stopTrack(srcId)
  })

  s.on('routing:update', async (connections: any[]) => {
    const toMe = connections.filter(c => c.to === clientId)
    console.log(`[routing] update: ${connections.length} total, ${toMe.length} to me (${clientId})`, JSON.stringify(toMe))
    _failedConsumers.clear()

    const newRouting: Record<number, string[]> = {}
    toMe.forEach(c => {
      if (!newRouting[c.channel]) newRouting[c.channel] = []
      newRouting[c.channel].push(c.from)
    })
    _currentRouting = newRouting

    const allSources = new Set(Object.values(newRouting).flat())

    // Mute consumers no longer in active routing — do NOT close them.
    // consumer.close() triggers SDP renegotiation on the recvTransport which causes
    // a brief glitch in ALL active audio (very audible on every TB press/release).
    // Just disabling the track is silent and instant; the consumer stays ready to
    // re-enable when the source comes back (e.g. sidetone suppression lifts).
    for (const [srcId, consumer] of _consumers.entries()) {
      if (!allSources.has(srcId)) {
        try { if (consumer.track) consumer.track.enabled = false } catch {}
        resetLevel(`recv_${srcId}`)
      }
    }

    // Re-enable or start consuming sources that are now routed
    for (const [ch, sources] of Object.entries(newRouting)) {
      for (const src of sources) {
        const existing = _consumers.get(src)
        if (existing) {
          const track = existing.track
          if (track && track.readyState === 'ended') {
            // Track ended (e.g. after AirPods connect triggers audio session restart).
            // The consumer is dead — drop it and create a fresh one.
            _consumers.delete(src)
            _activeStreams.delete(src)
            _consume(src, Number(ch))
          } else {
            try { if (track && !track.enabled) track.enabled = true } catch {}
          }
        } else {
          _consume(src, Number(ch))
        }
      }
    }
  })

  // When a producer registers for the first time (e.g. HOST starts mic after phone connected),
  // immediately consume it if it's in our current routing — avoids waiting for next routing:update.
  s.on('producer:ready', ({ clientId }: { clientId: string }) => {
    _failedConsumers.delete(clientId)
    for (const [ch, sources] of Object.entries(_currentRouting)) {
      if (sources.includes(clientId)) {
        _consume(clientId, Number(ch))
        break
      }
    }
  })

  // Consume stereo bridge streams for true L/R ear separation in AirPods.
  // When bridge-stereo-X-Y is available: chX audio → left ear, chY audio → right ear.
  // This replaces individual mono consumers for those channels.
  s.on('bridge:stereo:available', ({ stereoId, chL, chR }: { stereoId: string; chL: number; chR: number }) => {
    console.log(`[stereo] available: ${stereoId} (ch${chL}=L, ch${chR}=R)`)
    // Pre-consume all stereo pairs; mute immediately if not in active routing.
    // routing:update will re-enable when this pair becomes routed.
    _consume(stereoId, chL, true)
    // Only mute the component mono channels when the STEREO pair is routed here.
    // If the mono channel itself is in routing, leave it enabled.
    const routedSources = new Set(Object.values(_currentRouting).flat())
    if (routedSources.has(stereoId)) {
      ;[`bridge-ch${chL}`, `bridge-ch${chR}`].forEach(srcId => {
        const c = _consumers.get(srcId)
        if (c?.track && !routedSources.has(srcId)) { try { c.track.enabled = false } catch {} }
      })
    }
  })

  setTimeout(() => s.emit('routing:request:all'), 800)
}

// ─── Video slot lifecycle callbacks ───────────────────────────────────────
let _onVideoSlotStopped: ((slot: number) => void) | null = null
export function onVideoSlotStopped(cb: (slot: number) => void) { _onVideoSlotStopped = cb }

// ─── Video consumers ───────────────────────────────────────────────────────
const _videoSlots = new Map<number, {
  videoConsumer: any
  audioConsumer: any | null
  stream: MediaStream
  keyframeTimer: ReturnType<typeof setInterval> | null
}>()
const _availableVideoProducers = new Map<string, string>()

// Server-pushed routing: index 0 = slot V1, index 1 = slot V2, value = source number (0 = OFF)
let _videoRouting: number[] = []

export function setVideoRouting(sources: number[]) {
  _videoRouting = sources
  console.log('[video] routing updated:', sources)
}

export function getVideoRouting(): number[] { return [..._videoRouting] }

export function onVideoProducerAvailable(clientId: string, producerId: string) {
  _availableVideoProducers.set(clientId, producerId)
}

async function _serverResume(consumerId: string): Promise<void> {
  return new Promise(resolve => {
    _socket!.emit('consumer:resume', { consumerId }, () => resolve())
  })
}

async function _serverPause(consumerId: string): Promise<void> {
  return new Promise(resolve => {
    _socket!.emit('consumer:pause', { consumerId }, () => resolve())
  })
}

export async function consumeVideoSlot(slot: number): Promise<MediaStream | null> {
  if (_videoSlots.has(slot)) return _videoSlots.get(slot)!.stream
  if (!_device || !_recvTransport || !_socket) return null

  // Respect the host's routing matrix: _videoRouting[slot-1] is the source number (0 = OFF)
  const routedSource = _videoRouting.length > 0 ? (_videoRouting[slot - 1] ?? 0) : 0
  if (routedSource === 0) {
    console.log(`[video] slot ${slot} is OFF in routing matrix – not consuming`)
    return null
  }

  const clientId = `video-source-${routedSource}`
  if (!_availableVideoProducers.has(clientId)) {
    console.warn(`[video] no producer for slot ${slot} (source ${routedSource})`)
    return null
  }

  try {
    // ── Video track ──────────────────────────────────────────────────────────
    const videoResult = await new Promise<any>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('video consume timeout')), 8000)
      _socket!.emit('consume:request', {
        targetId: clientId,
        rtpCapabilities: _device.rtpCapabilities,
        transportId: _recvTransport.id,
        kind: 'video',
      }, (res: any) => { clearTimeout(t); resolve(res) })
    })

    if (!videoResult || videoResult.error) {
      console.warn(`[video] consume failed: ${videoResult?.error}`)
      return null
    }

    const videoConsumer = await _recvTransport.consume({
      id: videoResult.id,
      producerId: videoResult.producerId,
      kind: videoResult.kind,
      rtpParameters: videoResult.rtpParameters,
    })

    // Server creates video consumers paused – must resume server-side
    await _serverResume(videoConsumer.id)

    // When the host stops the camera the server closes the producer → stop our slot
    videoConsumer.on('producerclose', () => {
      console.log(`[video] slot ${slot} producer closed by host`)
      stopVideoSlot(slot)
      _onVideoSlotStopped?.(slot)
    })

    const stream = new MediaStream([videoConsumer.track])

    // ── Audio track ──────────────────────────────────────────────────────────
    let audioConsumer: any | null = null
    const audioClientId = `video-audio-source-${routedSource}`
    try {
      const audioResult = await new Promise<any>(resolve => {
        const t = setTimeout(() => resolve(null), 4000)
        _socket!.emit('consume:request', {
          targetId: audioClientId,
          rtpCapabilities: _device.rtpCapabilities,
          transportId: _recvTransport.id,
        }, (res: any) => { clearTimeout(t); resolve(res) })
      })
      if (audioResult && !audioResult.error) {
        audioConsumer = await _recvTransport.consume({
          id: audioResult.id,
          producerId: audioResult.producerId,
          kind: audioResult.kind,
          rtpParameters: audioResult.rtpParameters,
        })
        // Resume both client-side AND server-side so RTP actually flows
        try { if (audioConsumer.resume) await audioConsumer.resume() } catch {}
        await _serverResume(audioConsumer.id)
        // Register via _playTrack so native audio engine picks it up (same path as regular audio consumers)
        _playTrack(audioConsumer.track, `video-audio-${slot}`)
        // Also add to the video stream so RTCView has it
        stream.addTrack(audioConsumer.track)
        console.log(`[video] slot ${slot} audio ready | enabled=${audioConsumer.track?.enabled} muted=${audioConsumer.track?.muted} readyState=${audioConsumer.track?.readyState}`)
      } else {
        console.warn(`[video] slot ${slot} no embedded audio: ${audioResult?.error}`)
      }
    } catch (e) {
      console.warn(`[video] slot ${slot} audio consume failed:`, e)
    }

    // ── Periodic keyframe requests – prevents frozen test-pattern frames ─────
    const keyframeTimer = setInterval(() => {
      try { videoConsumer.requestKeyFrame?.() } catch {}
    }, 2000)

    _videoSlots.set(slot, { videoConsumer, audioConsumer, stream, keyframeTimer })
    console.log(`[video] ✅ slot ${slot} ready – tracks: ${stream.getTracks().length}`)
    return stream
  } catch (e) {
    console.error(`[video] slot ${slot} failed:`, e)
    return null
  }
}

export function setVideoSlotAudioEnabled(slot: number, enabled: boolean, volume = 1) {
  const s = _videoSlots.get(slot)
  if (!s?.audioConsumer) return
  try {
    const applyTrack = (t: any) => {
      t.enabled = enabled
      t._setVolume?.(enabled ? volume : 0)
    }
    s.stream.getAudioTracks().forEach(applyTrack)
    const audioStream = _activeStreams.get(`video-audio-${slot}`)
    audioStream?.getAudioTracks().forEach(applyTrack)
    // Server-side pause/resume stops RTP — more reliable than track.enabled on iOS
    if (enabled) _serverResume(s.audioConsumer.id).catch(() => {})
    else         _serverPause(s.audioConsumer.id).catch(() => {})
  } catch {}
}

export function stopVideoSlot(slot: number) {
  const s = _videoSlots.get(slot)
  if (!s) return
  if (s.keyframeTimer) clearInterval(s.keyframeTimer)
  // Silence immediately so the native audio engine stops before the consumer closes.
  // Without this the iOS audio renderer plays buffered audio after consumer.close().
  try {
    if (s.audioConsumer?.track) {
      s.audioConsumer.track.enabled = false
      s.audioConsumer.track._setVolume?.(0)
    }
  } catch {}
  try { s.videoConsumer.close() } catch {}
  try { s.audioConsumer?.close() } catch {}
  _stopTrack(`video-audio-${slot}`)
  _videoSlots.delete(slot)
  console.log(`[video] slot ${slot} stopped`)
}

// ─── Local test tone ───────────────────────────────────────────────────────
// Tone mode: disable AEC so the InCallManager ringback played through the
// speaker is NOT cancelled out before reaching the mic (and thus the producer).
// Without AEC disabled the echo-canceller treats the ringback as its own output
// and removes it from the mic feed, so no audio reaches the channel.
let _toneAecStream: any | null = null

export async function setToneMode(enabled: boolean): Promise<void> {
  if (!_micProducer) return
  try {
    if (enabled) {
      // New stream with all processing off → mic will pick up the speaker ringback
      _toneAecStream = await mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } as any,
        video: false,
      })
      const newTrack = (_toneAecStream.getAudioTracks() as any[])[0]
      if (newTrack) {
        newTrack.enabled = false
        await _micProducer.replaceTrack({ track: newTrack })
        console.log('[tone] AEC disabled, track replaced')
      }
    } else {
      // Restore normal mic stream with AEC enabled
      const stream = await mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } as any,
        video: false,
      })
      const newTrack = (stream.getAudioTracks() as any[])[0]
      if (newTrack) {
        newTrack.enabled = false
        await _micProducer.replaceTrack({ track: newTrack })
        console.log('[tone] AEC restored, track replaced')
      }
      if (_toneAecStream) {
        try { _toneAecStream.getTracks().forEach((t: any) => t.stop()) } catch {}
        _toneAecStream = null
      }
    }
  } catch (e) {
    console.warn('[tone] setToneMode failed:', e)
  }
}

export function getClientId() { return _clientId }

export function createPhoneRoute(targetId: string, channel = 2) {
  if (!_socket || !_clientId) return
  _socket.emit('connection:create', { from: _clientId, to: targetId, channel, bidirectional: false })
}

export function removePhoneRoute(targetId: string, channel = 2) {
  if (!_socket || !_clientId) return
  _socket.emit('connection:remove', { from: _clientId, to: targetId, channel })
}

export async function fetchAudioSources(): Promise<{ id: string; name: string }[]> {
  return new Promise(resolve => {
    const s = _socket
    if (!s) return resolve([])
    s.emit('audio:sources:list', (list: any[]) => resolve(list || []))
    setTimeout(() => resolve([]), 3000)
  })
}

export async function fetchPeerClients(): Promise<{ id: string; name: string }[]> {
  return new Promise(resolve => {
    const s = _socket
    if (!s) return resolve([])
    s.emit('clients:list', (list: any[]) => {
      resolve((list || [])
        .filter((c: any) => c.id !== _clientId && (c.type === 'mobile' || c.type === 'remote'))
        .map((c: any) => ({ id: c.id, name: c.name })))
    })
    setTimeout(() => resolve([]), 3000)
  })
}

// Create a TB-gated direct route: audio flows to targetId only when talkChannel is active
export function assignTbTarget(talkChannel: number, targetId: string) {
  if (!_socket || !_clientId) return
  _socket.emit('connection:create', {
    from: _clientId, to: targetId, channel: talkChannel, toChannel: talkChannel, bidirectional: false,
  })
}

export function removeTbTarget(talkChannel: number, targetId: string) {
  if (!_socket || !_clientId) return
  _socket.emit('connection:remove', { from: _clientId, to: targetId, channel: talkChannel })
}

// Replace the incoming source on a specific channel (removes current sources, adds new).
// Also evicts the source from any other channel it was already assigned to.
export function assignChannelSource(
  channel: number,
  sourceId: string,
  currentSources: string[],
  allRouting?: Record<number, string[]>,
) {
  if (!_socket || !_clientId) return
  currentSources.forEach(src =>
    _socket!.emit('connection:remove', { from: src, to: _clientId!, channel, bidirectional: false })
  )
  if (allRouting) {
    Object.entries(allRouting).forEach(([ch, sources]) => {
      const chNum = Number(ch)
      if (chNum !== channel && sources.includes(sourceId)) {
        _socket!.emit('connection:remove', { from: sourceId, to: _clientId!, channel: chNum, bidirectional: false })
      }
    })
  }
  _socket.emit('connection:create', { from: sourceId, to: _clientId, channel, bidirectional: false })
}

export function clearChannelSource(channel: number, currentSources: string[]) {
  if (!_socket || !_clientId) return
  currentSources.forEach(src =>
    _socket!.emit('connection:remove', { from: src, to: _clientId!, channel, bidirectional: false })
  )
}

export function playLocalTone(play: boolean) {
  try {
    if (play) InCallManager.startRingback('_DEFAULT_')
    else InCallManager.stopRingback()
  } catch {}
}

// ─── Consumer mute helpers ─────────────────────────────────────────────────
// Called immediately on TB press to silence incoming audio before the server
// round-trip completes (prevents echo during the ~100ms signaling latency).
export function muteAllConsumers() {
  for (const consumer of _consumers.values()) {
    try { if (consumer.track) consumer.track.enabled = false } catch {}
  }
}

// Called when talk stops — re-enables consumers that are in the current routing.
export function unmuteActiveConsumers() {
  const routedSources = new Set(Object.values(_currentRouting).flat())
  for (const [srcId, consumer] of _consumers.entries()) {
    if (routedSources.has(srcId)) {
      try { if (consumer.track && !consumer.track.enabled) consumer.track.enabled = true } catch {}
    }
  }
  // Re-apply IFB duck levels — mute-on-talk resets _setVolume to 0 via track.enabled
  if (_ifbActive) _applyIFBGains()
}

// ─── Disconnect ────────────────────────────────────────────────────────────
export function disconnectSocket() {
  for (const [srcId, c] of _consumers.entries()) {
    try { c.close() } catch {}; _stopTrack(srcId)
  }
  _consumers.clear(); _failedConsumers.clear(); _consuming.clear()
  for (const slot of _videoSlots.keys()) stopVideoSlot(slot)
  _availableVideoProducers.clear()
  try { _micProducer?.close() } catch {}
  try { _sendTransport?.close() } catch {}
  try { _recvTransport?.close() } catch {}
  _device = null; _sendTransport = null; _recvTransport = null; _micProducer = null
  _routingInit = false; _currentRouting = {}; _channelNames = {}; _videoRouting = []
  if (_socket) { _socket.removeAllListeners(); _socket.disconnect(); _socket = null }
  _connectedUrl = ''
  stopAudio()
}
