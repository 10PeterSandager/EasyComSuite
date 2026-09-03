// App.tsx – React Native root
console.log("[APP] App.tsx loading...")
import React, { useState, useEffect } from 'react'
import { StatusBar, LogBox, Linking } from 'react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import LoginScreen from './screens/LoginScreen'
import IntercomScreen from './screens/IntercomScreen'
import {
  fetchClients,
  validatePin,
  disconnectSocket,
  getSocket,
  initMediasoup,
  getLocalAudioStream,
  startMicProducer,
  initRouting,
  onChannelNames,
  startAudioSession,
} from './webrtc/intercom'

LogBox.ignoreLogs(['new NativeEventEmitter'])

export type ClientInfo = { id: string; name: string; code: string; status?: string }

export type QrConfig = { ip: string; port: string; tunnel: string }

export default function App() {
  const [screen,          setScreen]          = useState<'login' | 'intercom'>('login')
  const [connectedClient, setConnectedClient] = useState<ClientInfo | null>(null)
  const [clients,         setClients]         = useState<ClientInfo[]>([])
  const [error,           setError]           = useState('')
  const [loading,         setLoading]         = useState(false)
  const [channelNames,    setChannelNames]    = useState<Record<number, string>>({})
  const [qrConfig,        setQrConfig]        = useState<QrConfig | null>(null)

  useEffect(() => {
    onChannelNames(names => setChannelNames({ ...names }))
  }, [])

  // Handle easycommobile://setup?host=...&port=...&tunnel=... QR links
  useEffect(() => {
    const parseQrUrl = (url: string | null) => {
      if (!url) return
      const match = url.match(/^easycommobile:\/\/setup\?(.+)$/)
      if (!match) return
      const params = new URLSearchParams(match[1])
      const ip     = params.get('host') ?? ''
      const port   = params.get('port') ?? ''
      const tunnel = params.get('tunnel') ?? ''
      if (ip || port) setQrConfig({ ip, port, tunnel })
    }
    Linking.getInitialURL().then(parseQrUrl).catch(() => {})
    const sub = Linking.addEventListener('url', ({ url }) => parseQrUrl(url))
    return () => sub.remove()
  }, [])

  // ── Search ────────────────────────────────────────────────────────────────
  const handleSearch = async (ip: string, sessionPassword = '', ssl = false, port?: string) => {
    console.log('[App] handleSearch called with ip:', ip, 'port:', port)
    setLoading(true); setError('')
    // Merge port into host so buildServerUrl picks it up (e.g. "192.168.1.24:3001")
    const target = port ? `${ip}:${port}` : ip

    try {
      console.log('[App] fetching clients...')
      const list = await fetchClients(target, sessionPassword, ssl)
      console.log('[App] clients found:', list.length)
      // Deduplicate by name – if the same name appears multiple times (stale
      // registrations from previous sessions), keep the online one, or the last seen.
      const seen = new Map<string, any>()
      for (const c of list) {
        const existing = seen.get(c.name)
        if (!existing || c.status === 'online') seen.set(c.name, c)
      }
      const deduped = [...seen.values()].sort((a, b) => a.name.localeCompare(b.name))
      console.log('[App] clients after dedup:', deduped.length)
      setClients(deduped.map(c => ({ id: c.id, name: c.name, code: c.code || '0000', status: c.status })))
    } catch (e: any) {
      console.error('[App] search error:', e.message)
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  // ── Connect ───────────────────────────────────────────────────────────────
  const handleConnect = async (client: ClientInfo, pin: string) => {
    setLoading(true); setError('')
    try {
      console.log('[App] Step 1: validatePin...')
      const ok = await validatePin(client.id, pin)
      if (!ok) throw new Error('Invalid PIN code')
      console.log('[App] Step 2: PIN valid ✅')

      // Register with server
      const s = getSocket()
      if (!s) throw new Error('Socket not connected')
      await new Promise<void>(resolve => {
        s.emit('client:register',
          { id: client.id, name: client.name, type: 'mobile', code: client.code },
          () => resolve()
        )
        setTimeout(resolve, 2000)
      })
      console.log('[App] Step 3: registered ✅')

      console.log('[App] Step 4: initMediasoup...')
      await initMediasoup(client.id, client.name, client.code)
      console.log('[App] Step 5: mediasoup ready ✅')

      try {
        console.log('[App] Step 6: getUserMedia...')
        const micStream = await Promise.race([
          getLocalAudioStream(),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error('getUserMedia timeout')), 10000)),
        ])
        console.log('[App] Step 7: mic acquired ✅')
        await Promise.race([
          startMicProducer(micStream as any),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error('producer timeout')), 8000)),
        ])
        console.log('[App] Step 8: producer ready ✅')
      } catch (micErr: any) {
        console.warn('[App] mic failed (receive-only):', micErr.message)
      }

      console.log('[App] Step 9: initRouting...')
      initRouting(client.id)
      console.log('[App] Step 10: routing init ✅')

      setConnectedClient(client)
      setScreen('intercom')
    } catch (e: any) {
      console.error('[App] connect failed:', e.message)
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  // ── Disconnect ────────────────────────────────────────────────────────────
  const handleDisconnect = () => {
    disconnectSocket()
    setScreen('login')
    setConnectedClient(null)
    setChannelNames({})
  }

  // ── Offline mode ──────────────────────────────────────────────────────────
  const handleOpenWithoutConnection = () => {
    setConnectedClient({ id: 'offline', name: 'OFFLINE MODE', code: '' })
    setScreen('intercom')
  }

  // ── Socket emit helper ────────────────────────────────────────────────────
  const socketEmit = (event: string, data: any) => {
    getSocket()?.emit(event, data)
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar barStyle="light-content" backgroundColor="#000" />
        {screen === 'login' ? (
          <LoginScreen
            clients={clients}
            loading={loading}
            error={error}
            onSearch={handleSearch}
            onConnect={handleConnect}
            onOpenWithoutConnection={handleOpenWithoutConnection}
            qrConfig={qrConfig}
          />
        ) : (
          <IntercomScreen
            stationName={connectedClient?.name ?? ''}
            onDisconnect={handleDisconnect}
            socketEmit={socketEmit}
            channelNamesFromServer={channelNames}
          />
        )}
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}
