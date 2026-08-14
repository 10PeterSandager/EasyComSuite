import React, { useState, useEffect } from "react"

import { socket, startMicrophone, audioCtx } from "./client/webrtc/intercom"
import { setSocket, registerClient, attachMicrophone } from "./client/webrtc/clientHandshake"

import { ViewMode, Client, NetworkConfig, GPIOConfig } from "./types"

import HostView from "./components/HostView"
import MobileClientView from "./components/MobileClientView"

import {
  Radio,
  Maximize,
  Globe,
  Activity,
  Wifi,
  WifiOff
} from "lucide-react"

/* ---------------- GPIO ---------------- */

const INITIAL_GPIO: GPIOConfig[] = Array.from({ length: 8 }).map((_, i) => ({
  id: i,
  label: `GPIO OUT ${i + 1}`,
  ip: "192.168.1.21",
  port: 5000,
  protocol: "UDP",
  isActive: false
}))

/* ---------------- CLIENTS ---------------- */

const INITIAL_CLIENTS: Client[] = Array.from({ length: 1 }).map((_, i) => ({
  id: `client-${i}`,
  name: `CL ${String(i + 1).padStart(2, "0")}`,
  type: "" as any,
  status: "offline",
  isTalking: false,
  isLatched: false,
  gain: 50,
  volume: 100,
  isMuted: false,
  isIFBActive: false,
  isBacktalkActive: false,
  isTBVActive: false,
  tbActive: new Array(8).fill(false),
  gpioAssignment: 0,
  code: "0000",
  order: i,
  hidden: false,
  color: "#71717a",
  levels: Array(8).fill(-60),
  micLevel: -60,
  auxLevel: -60,
  muteOnTalk: [false,false,true,true,true,true,true,true],
  openOnTalk: [false,false,false,false,false,false,false,false],
  ifbNames: Array.from({ length: 8 }).map((_, idx) => `IFB ${idx + 1}`),
  inputGains: Array(8).fill(50),
  videoSources: []
}))

/* ---------------- APP ---------------- */

const App: React.FC = () => {

  const [view] = useState<ViewMode>(() => {
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)
    return isMobile ? ViewMode.MOBILE : ViewMode.HOST
  })

  const [clients, setClients] = useState<Client[]>(() => {
    try {
      const saved = localStorage.getItem('easycom:clients')
      if (saved) {
        const parsed: Client[] = JSON.parse(saved)
        if (Array.isArray(parsed) && parsed.length > 0)
          return parsed.map(c => ({ ...c, isTalking: false, isLatched: false, remoteIsLatched: false, status: 'offline' as const }))
      }
    } catch {}
    return INITIAL_CLIENTS
  })
  const [mobileClients, setMobileClients] = useState<Client[]>([])

  const [activeHostTab, setActiveHostTab] =
    useState<"grid" | "linking" | "video" | "setup" | "remote">("setup")

  const [network, setNetwork] = useState<NetworkConfig>(() => {
    const defaults: NetworkConfig = {
      ip: "192.168.1.21",
      subnet: "255.255.255.0",
      gateway: "0.0.0.0",
      port: 3000,
      danteMaster: false,
      encryptionKey: "",
      interfaceType: "REGULAR",
      activeSoundcard: "",
      deviceId: "easycom-host",
      inputCount: 2,
      outputCount: 2
    }
    try {
      const stored = localStorage.getItem('easycom_local_network')
      if (stored) return { ...defaults, ...JSON.parse(stored) }
    } catch {}
    return defaults
  })

  const [gpioConfigs, setGpioConfigs] = useState<GPIOConfig[]>(INITIAL_GPIO)

  const [theme, setTheme] = useState<"orange" | "blue">("orange")
  const [hostName, setHostName] = useState(() => localStorage.getItem('easycom_hostname') ?? "EASYCOM-HOST")

  // Persist hostname
  React.useEffect(() => {
    localStorage.setItem('easycom_hostname', hostName)
  }, [hostName])

  React.useEffect(() => {
    const t = setTimeout(() => {
      try { localStorage.setItem('easycom:clients', JSON.stringify(clients)) } catch {}
    }, 500)
    return () => clearTimeout(t)
  }, [clients])
  React.useEffect(() => {
    const save = () => { try { localStorage.setItem('easycom:clients', JSON.stringify(clients)) } catch {} }
    window.addEventListener('beforeunload', save)
    return () => window.removeEventListener('beforeunload', save)
  }, [clients])
  React.useEffect(() => {
    const handler = () => {
      try {
        localStorage.removeItem('easycom:clients')
        localStorage.removeItem('easycom:remotePanels')
        localStorage.removeItem('easycom:panelMappings')
      } catch {}
      setClients(INITIAL_CLIENTS)
    }
    socket.on('factory:reset', handler)
    return () => { socket.off('factory:reset', handler) }
  }, [])

  // Unlock AudioContext on first user gesture (Chrome autoplay policy)
  useEffect(() => {
    const unlock = () => { audioCtx.resume().catch(() => {}) }
    document.addEventListener('click', unlock, { once: true })
    document.addEventListener('keydown', unlock, { once: true })
    return () => {
      document.removeEventListener('click', unlock)
      document.removeEventListener('keydown', unlock)
    }
  }, [])
  const [isNetSynced, setIsNetSynced] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)

  // 🔥 Video streams – styres her og sendes ned til VideoTab via HostView
  const [videoStream1, setVideoStream1] = useState<MediaStream | null>(null)
  const [videoStream2, setVideoStream2] = useState<MediaStream | null>(null)
  const [videoStream3, setVideoStream3] = useState<MediaStream | null>(null)
  const [videoStream4, setVideoStream4] = useState<MediaStream | null>(null)

  // Video streams styres af VideoTab via startVideoStream prop
  // TestPattern kalder onStream → startVideoStream → videoStream1/2 sættes her

  const startVideoStream = async (channel: number, deviceId?: string, existingStream?: MediaStream): Promise<boolean> => {
    try {
      let stream = existingStream
      if (!stream) {
        if (!navigator.mediaDevices) throw new Error('navigator.mediaDevices not available – insecure context or permission denied')

        // Find the audio input device whose groupId matches the selected camera.
        // This gives us the camera's own built-in mic rather than the system default.
        let audioConstraint: boolean | MediaTrackConstraints = true
        if (deviceId) {
          try {
            const allDevices = await navigator.mediaDevices.enumerateDevices()
            const videoDevice = allDevices.find(d => d.kind === 'videoinput' && d.deviceId === deviceId)
            const matchedAudio = videoDevice?.groupId
              ? allDevices.find(d => d.kind === 'audioinput' && d.groupId === videoDevice.groupId)
              : null
            if (matchedAudio?.deviceId) {
              audioConstraint = { deviceId: { exact: matchedAudio.deviceId } }
              console.log(`[App] matched audio device for camera ${deviceId}: ${matchedAudio.label}`)
            }
          } catch {}
        }

        const videoConstraint = deviceId ? { deviceId: { exact: deviceId } } : true
        try {
          stream = await navigator.mediaDevices.getUserMedia({ video: videoConstraint, audio: audioConstraint })
          console.log(`[App] video+audio stream ch${channel}: ${stream.getAudioTracks()[0]?.label ?? 'no audio'}`)
        } catch {
          try {
            // Matched audio device failed – fall back to system default mic
            stream = await navigator.mediaDevices.getUserMedia({ video: videoConstraint, audio: true })
            console.log(`[App] video+default-mic stream ch${channel}`)
          } catch {
            stream = await navigator.mediaDevices.getUserMedia({ video: videoConstraint, audio: false })
            console.log('[App] video-only stream (no embedded audio)')
          }
        }
      }
      if (channel === 1) setVideoStream1(stream)
      else if (channel === 2) setVideoStream2(stream)
      else if (channel === 3) setVideoStream3(stream)
      else if (channel === 4) setVideoStream4(stream)
      return true
    } catch (e: any) {
      console.error(`[App] startVideoStream ch${channel} error:`, e?.name, e?.message, e)
      return false
    }
  }

  // 🔥 Produce video streams via WebRTC direkte fra App.tsx – uafhængigt af tab
  const videoProduced = React.useRef<Record<number, boolean>>({})
  const directPCs = React.useRef<Record<string, RTCPeerConnection>>({})

  // 🔥 Direct WebRTC video helper – bypasser mediasoup delivery
  const directVideoSent = React.useRef<Record<string, boolean>>({})
  // 🔥 Host-side routing: clientId → allowed source numbers
  const videoRouting = React.useRef<Record<string, number[]>>({})
  // Always-current clients ref — used in socket handlers to avoid stale closures
  const clientsRef = React.useRef<Client[]>(clients)
  React.useEffect(() => { clientsRef.current = clients }, [clients])

  // Seed videoRouting from localStorage clients on mount (restored after Cmd+R)
  React.useEffect(() => {
    clients.forEach(c => {
      if (c.videoSources && (c.videoSources as number[]).some(s => s > 0)) {
        videoRouting.current[c.id] = c.videoSources as number[]
      }
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Lyt på routing-opdateringer fra VideoTab
  React.useEffect(() => {
    const handler = ({ clientId, videoSources }: { clientId: string, videoSources: number[] }) => {
      videoRouting.current[clientId] = videoSources
      console.log(`[Host] Routing: ${clientId} → [${videoSources}]`)
    }
    socket.on('video:routing:update', handler)
    return () => { socket.off('video:routing:update', handler) }
  }, [socket])

  // 🔥 Mobile client talk/latch state updates
  React.useEffect(() => {
    const handler = ({ clientId, isTalking, isLatched, remoteIsLatched }: { clientId: string, isTalking?: boolean, isLatched?: boolean, remoteIsLatched?: boolean }) => {
      setClients(prev => prev.map(c => {
        if (c.id !== clientId) return c
        const updates: any = {}
        if (isTalking !== undefined) updates.isTalking = isTalking
        if (isLatched !== undefined) updates.isLatched = isLatched
        if (remoteIsLatched !== undefined) updates.remoteIsLatched = remoteIsLatched
        return { ...c, ...updates }
      }))
    }
    socket.on('client:state:update', handler)
    return () => { socket.off('client:state:update', handler) }
  }, [socket])

  // Sync server-side client state to HOST React state (type, status, name, code)
  React.useEffect(() => {
    if (view !== ViewMode.HOST) return
    const handler = ({ id, updates }: { id: string; updates: Partial<Client> }) => {
      const SYNC_FIELDS: (keyof Client)[] = ['status', 'type', 'name', 'code']
      const relevant = Object.fromEntries(
        Object.entries(updates).filter(([k]) => SYNC_FIELDS.includes(k as keyof Client))
      ) as Partial<Client>
      if (Object.keys(relevant).length === 0) return
      setClients(prev => prev.map(c => c.id === id ? { ...c, ...relevant } : c))
    }
    socket.on("clients:update", handler)
    return () => { socket.off("clients:update", handler) }
  }, [view])

  // Reset guard når streams skifter så nye offers kan sendes
  React.useEffect(() => {
    directVideoSent.current['video-source-1'] = false
    videoProduced.current[1] = false
  }, [videoStream1])
  React.useEffect(() => {
    directVideoSent.current['video-source-2'] = false
    videoProduced.current[2] = false
  }, [videoStream2])
  React.useEffect(() => {
    directVideoSent.current['video-source-3'] = false
    videoProduced.current[3] = false
  }, [videoStream3])
  React.useEffect(() => {
    directVideoSent.current['video-source-4'] = false
    videoProduced.current[4] = false
  }, [videoStream4])

  // 🔥 WebCodecs encoder – proper video chunks til mobil (ingen player bugs)
  const encodeStream = React.useCallback((stream: MediaStream, sourceId: string) => {
    const track = stream.getVideoTracks()[0]
    if (!track) return () => {}
    if (typeof (window as any).VideoEncoder !== 'function') {
      console.warn('[WebCodecs] VideoEncoder not available in this environment – skipping encode for', sourceId)
      return () => {}
    }
    let running = true
    let frameNum = 0
    const W = 320, H = 180

    const enc = new (window as any).VideoEncoder({
      output: (chunk: any) => {
        const buf = new Uint8Array(chunk.byteLength)
        chunk.copyTo(buf)
        socket.emit('video:chunk', {
          sourceId, data: buf, type: chunk.type, timestamp: chunk.timestamp
        })
        if (frameNum === 1) console.log(`[WebCodecs] ✅ Sender chunks for ${sourceId}`)
      },
      error: (e: any) => console.error('[WebCodecs]', e)
    })
    enc.configure({ codec: 'vp8', width: W, height: H, bitrate: 600_000, framerate: 25 })

    const ic = new (window as any).ImageCapture(track)
    ;(async () => {
      while (running) {
        try {
          const bmp = await ic.grabFrame()
          if (!running) { bmp.close(); break }
          const vf = new (window as any).VideoFrame(bmp, { timestamp: frameNum * 40000 })
          enc.encode(vf, { keyFrame: true })
          vf.close(); bmp.close(); frameNum++
        } catch(e) {}
        await new Promise(r => setTimeout(r, 40))
      }
      try { await enc.flush(); enc.close() } catch(e) {}
    })()
    console.log(`[WebCodecs] Starter for ${sourceId}`)
    return () => { running = false }
  }, [])

  React.useEffect(() => { if (videoStream1) return encodeStream(videoStream1, 'video-source-1') }, [videoStream1, encodeStream])
  React.useEffect(() => { if (videoStream2) return encodeStream(videoStream2, 'video-source-2') }, [videoStream2, encodeStream])
  const startDirectVideo = React.useCallback(async (channel: number, stream: MediaStream) => {
    const sourceId = `video-source-${channel}`
    if (directVideoSent.current[sourceId]) return  // undgå duplikat
    directVideoSent.current[sourceId] = true
    const track = stream.getVideoTracks()[0]?.clone()  // clone så mediasoup track ikke forstyrres
    if (!track) return
    // Luk eksisterende PC
    if (directPCs.current[sourceId]) {
      directPCs.current[sourceId].close()
      delete directPCs.current[sourceId]
    }
    const pc = new RTCPeerConnection({ iceServers: [] })
    directPCs.current[sourceId] = pc
    pc.addTrack(track)
    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer)
    // Vent på ICE gathering (localhost er hurtigt)
    await new Promise<void>(resolve => {
      if (pc.iceGatheringState === 'complete') { resolve(); return }
      pc.onicegatheringstatechange = () => { if (pc.iceGatheringState === 'complete') resolve() }
      setTimeout(resolve, 3000)
    })
    console.log(`[DirectVideo] Sender offer for ${sourceId}`)
    socket.emit('video:direct:offer', { sourceId, sdp: pc.localDescription!.sdp })
    // Lyt på answer – kun fra denne specifikke PC session
    const answerHandler = ({ sdp }: { sdp: string }) => {
      if (pc.signalingState !== 'have-local-offer') return // ignorer stale answers
      console.log(`[DirectVideo] Modtog answer for ${sourceId}, ICE state:`, pc.iceConnectionState)
      pc.setRemoteDescription({ type: 'answer', sdp })
        .then(() => console.log(`[DirectVideo] ✅ Remote desc sat for ${sourceId}`))
        .catch(e => console.warn('[DirectVideo] setRemoteDescription fejl:', e))
      pc.oniceconnectionstatechange = () => console.log(`[DirectVideo] ICE ${sourceId}:`, pc.iceConnectionState)
    }
    socket.off(`video:direct:answer:${sourceId}`)
    socket.on(`video:direct:answer:${sourceId}`, answerHandler)
  }, [socket])

  // 🔥 Send streams til klient baseret på routing
  React.useEffect(() => {
    const handler = async ({ toSocketId, clientId }: { toSocketId: string, clientId?: string }) => {
      // Fall back to clients state (loaded from localStorage) if routing ref not yet populated
      const fallback = clientId !== undefined
        ? clientsRef.current.find(c => c.id === clientId)?.videoSources
        : undefined
      const allowed = (clientId !== undefined ? videoRouting.current[clientId] : undefined) ?? fallback
      console.log(`[DirectVideo] Klient ${toSocketId} (${clientId}), routing: ${allowed === undefined ? 'INGEN' : `[${allowed}]`}`)
      if (!allowed || allowed.every((s: number) => s === 0)) return
      const allStreams: Record<number, MediaStream | null> = {
        1: videoStream1, 2: videoStream2, 3: videoStream3, 4: videoStream4
      }
      for (let slotIdx = 0; slotIdx < 2; slotIdx++) {
        const srcNum = allowed[slotIdx]
        if (!srcNum || srcNum === 0) continue
        const stream = allStreams[srcNum]
        if (!stream) continue
        const slot = (slotIdx + 1) as 1 | 2
        const key = `slot${slot}-${toSocketId}`
        directPCs.current[key]?.close()
        const pc = new RTCPeerConnection({ iceServers: [] })
        directPCs.current[key] = pc
        const track = stream.getVideoTracks()[0]?.clone()
        if (!track) continue
        pc.addTrack(track)
        const offer = await pc.createOffer()
        await pc.setLocalDescription(offer)
        await new Promise<void>(resolve => {
          if (pc.iceGatheringState === 'complete') { resolve(); return }
          pc.onicegatheringstatechange = () => { if (pc.iceGatheringState === 'complete') resolve() }
          setTimeout(resolve, 3000)
        })
        socket.emit('video:direct:offer', { sourceId: `preview-slot${slot}`, sdp: pc.localDescription!.sdp, toSocketId, slot })
        socket.once(`video:direct:answer:preview-slot${slot}:${toSocketId}`, ({ sdp }: { sdp: string }) => {
          pc.setRemoteDescription({ type: 'answer', sdp }).catch(() => {})
        })
        console.log(`[DirectVideo] Sender stream ${srcNum} → slot ${slot} til ${toSocketId}`)
      }
    }
    socket.on('video:direct:request-from-client', handler)
    return () => { socket.off('video:direct:request-from-client', handler) }
  }, [socket, videoStream1, videoStream2, videoStream3, videoStream4])

  useEffect(() => {
    const produce = async (ch: number, stream: MediaStream | null) => {
      if (!stream) return
      console.log(`[App] produce ch${ch} – videoProduced:`, videoProduced.current[ch])
      try {
        const { produceVideoStream, closeVideoProducer, isMediasoupReady, initMediasoup } = await import('./client/webrtc/mediasoupClient')
        if (videoProduced.current[ch]) {
          closeVideoProducer(ch)
          videoProduced.current[ch] = false
        }
        let waited = 0
        while (!isMediasoupReady() && waited < 15000) {
          await new Promise(r => setTimeout(r, 300))
          waited += 300
        }
        if (!isMediasoupReady()) await initMediasoup()
        const { videoId, audioId } = await produceVideoStream(stream, ch)
        videoProduced.current[ch] = true
        socket.emit('producer:register', { clientId: `video-source-${ch}`, producerId: videoId, kind: 'video' })
        if (audioId) socket.emit('producer:register', { clientId: `video-audio-source-${ch}`, producerId: audioId, kind: 'audio' })
        console.log(`[App] ✅ video-source-${ch} produceret: ${videoId} (audio: ${audioId})`)
        await startDirectVideo(ch, stream)
      } catch (e) {
        console.warn(`[App] video produce fejl ch${ch}:`, e)
      }
    }
    if (videoStream1) produce(1, videoStream1)
  }, [videoStream1, startDirectVideo])

  useEffect(() => {
    const produce = async (ch: number, stream: MediaStream | null) => {
      if (!stream) return
      console.log(`[App] produce ch${ch} – videoProduced:`, videoProduced.current[ch])
      try {
        const { produceVideoStream, closeVideoProducer, isMediasoupReady, initMediasoup } = await import('./client/webrtc/mediasoupClient')
        if (videoProduced.current[ch]) {
          closeVideoProducer(ch)
          videoProduced.current[ch] = false
        }
        let waited = 0
        while (!isMediasoupReady() && waited < 15000) {
          await new Promise(r => setTimeout(r, 300))
          waited += 300
        }
        if (!isMediasoupReady()) await initMediasoup()
        const { videoId, audioId } = await produceVideoStream(stream, ch)
        videoProduced.current[ch] = true
        socket.emit('producer:register', { clientId: `video-source-${ch}`, producerId: videoId, kind: 'video' })
        if (audioId) socket.emit('producer:register', { clientId: `video-audio-source-${ch}`, producerId: audioId, kind: 'audio' })
        console.log(`[App] ✅ video-source-${ch} produceret: ${videoId} (audio: ${audioId})`)
        await startDirectVideo(ch, stream)
      } catch (e) {
        console.warn(`[App] video produce fejl ch${ch}:`, e)
      }
    }
    if (videoStream2) produce(2, videoStream2)
  }, [videoStream2, startDirectVideo])

  useEffect(() => {
    const produce = async (ch: number, stream: MediaStream | null) => {
      if (!stream) return
      console.log(`[App] produce ch${ch} – videoProduced:`, videoProduced.current[ch])
      try {
        const { produceVideoStream, closeVideoProducer, isMediasoupReady, initMediasoup } = await import('./client/webrtc/mediasoupClient')
        if (videoProduced.current[ch]) {
          closeVideoProducer(ch)
          videoProduced.current[ch] = false
        }
        let waited = 0
        while (!isMediasoupReady() && waited < 15000) {
          await new Promise(r => setTimeout(r, 300)); waited += 300
        }
        if (!isMediasoupReady()) await initMediasoup()
        const { videoId, audioId } = await produceVideoStream(stream, ch)
        videoProduced.current[ch] = true
        socket.emit('producer:register', { clientId: `video-source-${ch}`, producerId: videoId, kind: 'video' })
        if (audioId) socket.emit('producer:register', { clientId: `video-audio-source-${ch}`, producerId: audioId, kind: 'audio' })
        console.log(`[App] ✅ video-source-${ch} produceret: ${videoId} (audio: ${audioId})`)
        await startDirectVideo(ch, stream)
      } catch (e) { console.warn(`[App] video produce fejl ch${ch}:`, e) }
    }
    if (videoStream3) produce(3, videoStream3)
  }, [videoStream3, startDirectVideo])

  useEffect(() => {
    const produce = async (ch: number, stream: MediaStream | null) => {
      if (!stream) return
      console.log(`[App] produce ch${ch} – videoProduced:`, videoProduced.current[ch])
      try {
        const { produceVideoStream, closeVideoProducer, isMediasoupReady, initMediasoup } = await import('./client/webrtc/mediasoupClient')
        if (videoProduced.current[ch]) {
          closeVideoProducer(ch)
          videoProduced.current[ch] = false
        }
        let waited = 0
        while (!isMediasoupReady() && waited < 15000) {
          await new Promise(r => setTimeout(r, 300)); waited += 300
        }
        if (!isMediasoupReady()) await initMediasoup()
        const { videoId, audioId } = await produceVideoStream(stream, ch)
        videoProduced.current[ch] = true
        socket.emit('producer:register', { clientId: `video-source-${ch}`, producerId: videoId, kind: 'video' })
        if (audioId) socket.emit('producer:register', { clientId: `video-audio-source-${ch}`, producerId: audioId, kind: 'audio' })
        console.log(`[App] ✅ video-source-${ch} produceret: ${videoId} (audio: ${audioId})`)
        await startDirectVideo(ch, stream)
      } catch (e) { console.warn(`[App] video produce fejl ch${ch}:`, e) }
    }
    if (videoStream4) produce(4, videoStream4)
  }, [videoStream4, startDirectVideo])

  const stopVideoStream = (channel: number) => {
    // Close mediasoup producers first so the mobile's consumer fires producerclose
    import('./client/webrtc/mediasoupClient').then(({ closeVideoProducer }) => {
      closeVideoProducer(channel)
    }).catch(() => {})
    // Allow the channel to be re-produced when restarted
    videoProduced.current[channel] = false
    const stop = (stream: MediaStream | null, setter: (s: MediaStream | null) => void) => {
      stream?.getTracks().forEach(t => t.stop())
      setter(null)
    }
    if (channel === 1) stop(videoStream1, setVideoStream1)
    else if (channel === 2) stop(videoStream2, setVideoStream2)
    else if (channel === 3) stop(videoStream3, setVideoStream3)
    else if (channel === 4) stop(videoStream4, setVideoStream4)
  }

  /* ---------------- MOBILE CLIENT FETCH ---------------- */

  useEffect(() => {
    if (view !== ViewMode.MOBILE) return
    const fetchClients = () => {
      socket.emit("clients:list", (list: any[]) => {
        setMobileClients(list.map(c => ({ ...INITIAL_CLIENTS[0], ...c })))
      })
    }
    if (socket.connected) fetchClients()
    socket.on("connect", fetchClients)
    socket.on("clients:update", fetchClients)
    return () => {
      socket.off("connect", fetchClients)
      socket.off("clients:update", fetchClients)
    }
  }, [view])

  /* ---------------- SERVER ---------------- */

  useEffect(() => {

    if (view !== ViewMode.HOST) return

    const interval = setInterval(() => {

      if (socket?.connected) {

        setIsNetSynced(true)

        setSocket(socket)

        registerClient({
          id: "host-ui",
          name: "EasyCom Host",
          type: "desktop"
        })

        // 🔥 Registrér alle 64 clients på serveren så mobil-dropdown virker
        clients.forEach(c => {
          socket.emit("client:register", {
            id: c.id,
            name: c.name,
            type: c.type || "",
            code: c.code || "0000"
          }, () => {})
        })

        attachMicrophone()

        clearInterval(interval)

      }

    }, 300)

    return () => clearInterval(interval)

  }, [])

  /* ---------------- MIC TEST ---------------- */

  const startMicTest = async () => {

    try {
      await startMicrophone()
    } catch (err) {
      console.error("MIC ERROR", err)
    }

  }

  /* ---------------- FULLSCREEN ---------------- */

  useEffect(() => {

    const handleFsChange = () => {
      setIsFullscreen(!!document.fullscreenElement)
    }

    document.addEventListener("fullscreenchange", handleFsChange)

    return () =>
      document.removeEventListener("fullscreenchange", handleFsChange)

  }, [])

  const toggleFullscreen = () => {

    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen()
    } else {
      document.exitFullscreen()
    }

  }

  const themeColor = theme === "orange" ? "orange" : "blue"

  /* ---------------- RENDER ---------------- */

  

  return (

    <div className={`flex flex-col h-screen selection:bg-${themeColor}-500/30`}>

      {!isFullscreen && (

        <div className="flex items-center justify-between px-6 py-2 bg-black/40 border-b border-white/5">

          <div className="flex items-center gap-6">

            <div className="flex items-center gap-3">
              <div className={`p-1.5 rounded bg-${themeColor}-600`}>
                <Radio size={18} className="text-white"/>
              </div>

              <span className="font-black text-white uppercase tracking-tight">
                EASYC<span className={`text-${themeColor}-500`}>O</span>M
              </span>
            </div>

            <div className="h-6 w-px bg-white/10"/>

            <div className={`flex items-center gap-2 px-3 py-1 rounded-full border
              ${isNetSynced
                ? "bg-green-600/10 border-green-500/40 text-green-500"
                : "bg-red-600/10 border-red-500/40 text-red-500 animate-pulse"
              }`}>

              {isNetSynced ? <Wifi size={12}/> : <WifiOff size={12}/>}

              <span className="text-[9px] font-black uppercase">
                {isNetSynced ? "Sync Active" : "Disconnected"}
              </span>

            </div>

          </div>

          <div className="flex items-center gap-4">

            <div className="flex items-center gap-2 px-3 py-1.5 border rounded bg-black/40">
              <Globe size={12} className={`text-${themeColor}-500`} />
              <span className="text-[9px] font-black uppercase">
                {hostName}
              </span>
            </div>

            <button
              onClick={toggleFullscreen}
              className="flex items-center gap-2 px-3 py-1.5 border rounded bg-zinc-800 text-zinc-400 hover:text-white"
            >
              <Maximize size={12}/>
              <span className="text-[9px] font-black uppercase">
                Fullscreen
              </span>
            </button>

          </div>

        </div>

      )}

      <main className="flex-1 overflow-hidden">

        {view === ViewMode.MOBILE && (
          <MobileClientView
            availableClients={mobileClients}
            onUpdateRemote={() => {}}
            theme={theme}
            sharedStream1={null}
            sharedStream2={null}
          />
        )}

        {view === ViewMode.HOST && (

          <HostView
            activeTab={activeHostTab}
            setActiveTab={setActiveHostTab}

            clients={clients}

            updateClient={(id: string, u: Partial<Client>) => {
              setClients(prev => prev.map(c => c.id === id ? { ...c, ...u } : c))
              // 🔥 Sync til server så mobil-dropdown opdateres
              socket.emit("client:update", { id, updates: u })
            }}

            deleteClients={(ids: string[]) =>
              setClients(prev => prev.filter(c => !ids.includes(c.id)))
            }

            updateMultipleClients={(ids: string[], u: Partial<Client>) => {
              setClients(prev => prev.map(c => ids.includes(c.id) ? { ...c, ...u } : c))
              // 🔥 Sync alle ændringer til server
              ids.forEach(id => socket.emit("client:update", { id, updates: u }))
            }}

            addClient={(count?: number, overrides?: any) =>
              setClients(prev => {
                const n = count ?? 1
                const newClients = Array.from({ length: n }, (_, i) => ({
                  ...INITIAL_CLIENTS[0],
                  id: `client-${Date.now()}-${i}`,
                  name: `CL ${String(prev.length + i + 1).padStart(2, '0')}`,
                  type: "" as any,
                  code: "0000",
                  ...(overrides ?? {}),
                }))
                // Register new clients on server immediately
                newClients.forEach(c => {
                  socket.emit("client:register", {
                    id: c.id, name: c.name, type: c.type || "", code: c.code || "0000"
                  }, () => {})
                })
                return [...prev, ...newClients]
              })
            }

            network={network}
            setNetwork={setNetwork}

            theme={theme}
            setTheme={setTheme}

            hostName={hostName}
            setHostName={setHostName}

            gpioConfigs={gpioConfigs}
            setGpioConfigs={setGpioConfigs}

            typeColors={{
              mobile:"#ea580c",
              desktop:"#3b82f6",
              remote:"#8b5cf6",
              aux:"#10b981"
            }}

            videoStream1={videoStream1}
            videoStream2={videoStream2}
            videoStream3={videoStream3}
            videoStream4={videoStream4}
            startVideoStream={startVideoStream}
            stopVideoStream={stopVideoStream}
            onRoutingChange={(clientId: string, videoSources: number[]) => {
              const prev = videoRouting.current[clientId] || []
              videoRouting.current[clientId] = videoSources
              console.log(`[Host] Routing: ${clientId} → [${videoSources}] (prev: [${prev}])`)
              socket.emit('video:routing:update', { clientId, videoSources })

              const prevActive = prev.filter((s: number) => s > 0)
              const newActive = videoSources.filter((s: number) => s > 0)

              // Luk ALLE PCs for slots der ændres (både source-* og slot*- nøgler)
              const allSlots = [0, 1]
              allSlots.forEach(slotIdx => {
                const prevSrc = prev[slotIdx] ?? 0
                const newSrc = videoSources[slotIdx] ?? 0
                if (prevSrc !== newSrc && prevSrc > 0) {
                  const slot = slotIdx + 1
                  // Luk slot-baserede PCs
                  Object.keys(directPCs.current).forEach(key => {
                    if (key.startsWith(`slot${slot}-`) || key.startsWith(`video-source-${prevSrc}`)) {
                      directPCs.current[key].close()
                      delete directPCs.current[key]
                      console.log(`[Host] Lukkede PC: ${key}`)
                    }
                  })
                  directVideoSent.current[`video-source-${prevSrc}`] = false
                  // Send cleared til mobilen direkte fra host
                  socket.emit('video:routing:cleared:to:client', { clientId, slot })
                }
              })

              // Hvis alt er slukket – luk alle slot-PCs
              if (newActive.length === 0 && prevActive.length > 0) {
                Object.keys(directPCs.current).forEach(key => {
                  if (key.startsWith('slot')) {
                    directPCs.current[key].close()
                    delete directPCs.current[key]
                  }
                })
              }
            }}
          />

        )}

      </main>

    </div>

  )

}

export default App