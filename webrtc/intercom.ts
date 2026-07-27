// webrtc/intercom.ts – React Native version
// Uses react-native-webrtc instead of browser WebRTC

import { io, Socket } from 'socket.io-client'
import InCallManager from 'react-native-incall-manager'

// 🔥 Register react-native-webrtc BEFORE importing mediasoup-client
import {
  MediaStream,
  MediaStreamTrack,
  RTCIceCandidate,
  RTCPeerConnection,
  RTCSessionDescription,
  mediaDevices,
  registerGlobals,
} from 'react-native-webrtc'

registerGlobals()

let _socket: Socket | null = null
let _channelNames: Record<number, string> = {}
let _channelNameCb: ((names: Record<number, string>) => void) | null = null

export function getSocket(): Socket | null { return _socket }
export function getChannelNames() { return _channelNames }
export function onChannelNames(cb: (n: Record<number, string>) => void) { _channelNameCb = cb }

export async function connectSocket(hostIp: string): Promise<Socket> {
  if (_socket?.connected) return _socket
  if (_socket) { _socket.removeAllListeners(); _socket.disconnect() }

  return new Promise((resolve, reject) => {
    const url = `http://${hostIp}:3000`
    console.log('[intercom] connecting to', url)

    const s = io(url, {
      transports: ['websocket'],
      timeout: 5000,
      reconnection: true,
      reconnectionDelay: 2000,
    })

    const t = setTimeout(() => {
      s.disconnect()
      reject(new Error(`Timeout: no connection to ${url}`))
    }, 6000)

    s.once('connect', () => {
      clearTimeout(t)
      console.log('[intercom] ✅ connected')
      _socket = s

      // Channel names push from host
      s.on('channel:names:push', (names: Record<number, string>) => {
        _channelNames = names
        _channelNameCb?.(names)
      })

      s.on('kicked', () => {
        console.log('[intercom] kicked by host')
        _channelNames = {}
      })

      resolve(s)
    })

    s.once('connect_error', (err) => {
      clearTimeout(t); s.disconnect(); reject(new Error(`Connection error: ${err.message}`))
    })
  })
}

export async function fetchClients(hostIp: string): Promise<any[]> {
  const s = await connectSocket(hostIp)
  return new Promise((resolve, reject) => {
    s.emit('clients:list', (clients: any[]) => {
      if (!Array.isArray(clients)) return reject(new Error('Invalid response'))
      resolve(clients.filter(c => c.type === 'mobile' && c.id !== 'host-ui' && c.id !== 'producer-65'))
    })
    setTimeout(() => reject(new Error('Timeout')), 4000)
  })
}

export async function validatePin(clientId: string, code: string): Promise<boolean> {
  const s = _socket
  if (!s) return false
  return new Promise(resolve => {
    s.emit('client:auth', { clientId, code }, (result: any) => resolve(result?.ok === true))
    setTimeout(() => resolve(false), 3000)
  })
}

// 🎤 Get local audio stream from microphone
export async function getLocalAudioStream(): Promise<MediaStream> {
  // Start InCallManager for proper audio routing on iOS
  InCallManager.start({ media: 'audio' })
  InCallManager.setSpeakerphoneOn(true)

  const stream = await mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
    video: false,
  })
  return stream as unknown as MediaStream
}

export function stopAudio() {
  InCallManager.stop()
}

export function disconnectSocket() {
  if (_socket) {
    _socket.removeAllListeners()
    _socket.disconnect()
    _socket = null
  }
  _channelNames = {}
  stopAudio()
}
