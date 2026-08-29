// screens/IntercomScreen.tsx
import React, { useState, useEffect, useRef } from 'react'
import {
  View, Text, TouchableOpacity, Pressable, StyleSheet, SafeAreaView,
  Modal, TextInput, Switch, Alert, ScrollView,
  Keyboard, TouchableWithoutFeedback, Platform, Vibration,
  useWindowDimensions,
} from 'react-native'
import { RTCView } from 'react-native-webrtc'

const ACCENT = '#f97316'
const BG     = '#09090b'
const CARD   = '#18181b'
const BORDER = '#27272a'
const GREEN  = '#22c55e'
const RED_C  = '#ef4444'

const SHUFFLE_ORDERS = [
  [0, 1, 2, 3],
  [2, 0, 3, 1],
  [3, 2, 1, 0],
  [1, 3, 0, 2],
]

interface Props {
  stationName: string
  onDisconnect: () => void
  socketEmit?: (event: string, data: any) => void
  channelNamesFromServer?: Record<number, string>
}

export default function IntercomScreen({
  stationName, onDisconnect, socketEmit, channelNamesFromServer = {},
}: Props) {

  const { width, height } = useWindowDimensions()
  const isLandscape = width > height

  const [talkActive,  setTalkActive]  = useState({ talk1:false, talk2:false, talk3:false, talk4:false })
  const [talkLatched, setTalkLatched] = useState({ talk1:false, talk2:false, talk3:false, talk4:false })
  const [talkNames,   setTalkNames]   = useState({ talk1:'Producer', talk2:'Talk 2', talk3:'Talk 3', talk4:'Talk 4' })
  const [editedNames, setEditedNames] = useState({ talk1:'Producer', talk2:'Talk 2', talk3:'Talk 3', talk4:'Talk 4' })
  const [shuffleOffset, setShuffleOffset] = useState(0)
  const [showV1, setShowV1] = useState(false)
  const [showV2, setShowV2] = useState(false)

  // Meters – only server-driven, no fake animation
  const [meterLevels, setMeterLevels] = useState<number[]>(new Array(8).fill(0))

  const [gains, setGains] = useState<number[]>(new Array(8).fill(80))
  const [pans,  setPans]  = useState<number[]>(new Array(8).fill(0)) // -1=L, 0=C, 1=R
  const [audioStreams,   setAudioStreams]   = useState<any[]>([])
  const [videoStreamUrl, setVideoStreamUrl] = useState<(string|null)[]>([null, null])
  const [videoStreams,   setVideoStreams]   = useState<(any|null)[]>([null, null])
  const [videoVolume,   setVideoVolume]    = useState<number[]>([100, 100])
  const [videoFullscreen, setVideoFullscreen] = useState<number|null>(null)
  const [showVideoControls, setShowVideoControls] = useState<Record<number,boolean>>({})
  const [channelNames, setChannelNames] = useState<Record<number,string>>(channelNamesFromServer)
  const [logicPairIdx, setLogicPairIdx] = useState<number|null>(null)
  const [tapNameIdx, setTapNameIdx] = useState<number|null>(null)
  const [isRotated, setIsRotated] = useState(false)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [toneActive, setToneActive] = useState(false)
  const [routing, setRouting] = useState<Record<number, string[]>>({})
  const [tallyState, setTallyState] = useState<'program' | 'preview' | 'off'>('off')
  const [meterSectionBottom, setMeterSectionBottom] = useState(0)
  const [gpoEnabled, setGpoEnabled] = useState(false)
  const gpoFiredRef = useRef(false)

  // Wire audio streams to RTCViews so react-native-webrtc activates native playback
  useEffect(() => {
    import('../webrtc/intercom').then(({ onStreamAdded, onStreamRemoved, getActiveStreams }) => {
      const existing = getActiveStreams()
      if (existing.size > 0) setAudioStreams(Array.from(existing.values()))
      onStreamAdded((stream: any) => {
        setAudioStreams(prev => {
          if (prev.includes(stream)) return prev
          return [...prev, stream]
        })
      })
      onStreamRemoved((stream: any) => {
        setAudioStreams(prev => prev.filter(s => s !== stream))
      })
    })
  }, [])

  // Double-tap detection ref (slot index → timestamp of last tap)
  const lastTapRef = useRef<Record<number,number>>({})

  // Refs to read current state inside socket callbacks without stale closures
  const showV1Ref = useRef(false)
  const showV2Ref = useRef(false)
  const videoStreamUrlRef = useRef<(string|null)[]>([null, null])
  useEffect(() => { showV1Ref.current = showV1 }, [showV1])
  useEffect(() => { showV2Ref.current = showV2 }, [showV2])
  useEffect(() => { videoStreamUrlRef.current = videoStreamUrl }, [videoStreamUrl])

  useEffect(() => { setChannelNames(channelNamesFromServer) }, [channelNamesFromServer])
  useEffect(() => { socketEmit?.('client:talknames', talkNames) }, [talkNames])

  // Keep routing state updated
  useEffect(() => {
    let iv: ReturnType<typeof setInterval> | null = null
    import('../webrtc/intercom').then(({ getChannelRouting }) => {
      const update = () => setRouting({ ...getChannelRouting() })
      update()
      iv = setInterval(update, 1000)
    })
    return () => { if (iv) clearInterval(iv) }
  }, [])

  // GPO: release if disabled while active
  useEffect(() => {
    if (!gpoEnabled && gpoFiredRef.current) {
      socketEmit?.('client:gpo:release', {})
      gpoFiredRef.current = false
    }
  }, [gpoEnabled])

  // Tally indicator
  useEffect(() => {
    let cleanup: (() => void) | null = null
    import('../webrtc/intercom').then(({ getSocket }) => {
      const s = getSocket()
      if (!s) return
      const handler = ({ state }: { state: 'program' | 'preview' | 'off' }) => setTallyState(state ?? 'off')
      s.on('tally:update', handler)
      cleanup = () => s.off('tally:update', handler)
    })
    return () => { cleanup?.() }
  }, [])

  // Host matrix OFF → stop video slot on mobile
  useEffect(() => {
    let cleanup: (() => void) | null = null
    import('../webrtc/intercom').then(({ getSocket }) => {
      const s = getSocket()
      if (!s) return
      const handler = ({ slot }: { slot: number }) => {
        if (slot === 1) { setShowV1(false); setShowVideoControls(p => ({ ...p, 0: false })) }
        if (slot === 2) { setShowV2(false); setShowVideoControls(p => ({ ...p, 1: false })) }
      }
      s.on('video:routing:cleared', handler)
      cleanup = () => s.off('video:routing:cleared', handler)
    })
    return () => { cleanup?.() }
  }, [])

  const applyVideoVolume = (slot: number, vol: number, streams = videoStreams) => {
    const stream = streams[slot]
    const enabled = vol > 0
    if (stream) {
      try {
        stream.getAudioTracks?.()?.forEach((t: any) => {
          t.enabled = enabled
          t._setVolume?.(enabled ? vol / 100 : 0)
        })
      } catch {}
    }
    import('../webrtc/intercom').then(({ setVideoSlotAudioEnabled }) => {
      setVideoSlotAudioEnabled(slot + 1, enabled, vol / 100)
    }).catch(() => {})
  }

  // 1 tap → toggle audio controls  |  2 taps (< 350 ms) → fullscreen
  const handleVideoTap = (slotIdx: number) => {
    const now = Date.now()
    const last = lastTapRef.current[slotIdx] || 0
    if (now - last < 350) {
      lastTapRef.current[slotIdx] = 0
      setVideoFullscreen(slotIdx)
    } else {
      lastTapRef.current[slotIdx] = now
      setTimeout(() => {
        if (lastTapRef.current[slotIdx] === now)
          setShowVideoControls(p => ({ ...p, [slotIdx]: !p[slotIdx] }))
      }, 350)
    }
  }

  // Sequence numbers per slot — each new retry supersedes the previous one instead of
  // being silently blocked (the old mutex approach). A stale result is discarded.
  const retrySeqRef = useRef<Record<number, number>>({})

  const retryVideoSlot = (slotIdx: number) => {
    const seq = (retrySeqRef.current[slotIdx] ?? 0) + 1
    retrySeqRef.current[slotIdx] = seq
    const slot = slotIdx + 1
    import('../webrtc/intercom').then(({ consumeVideoSlot, stopVideoSlot }) => {
      if (retrySeqRef.current[slotIdx] !== seq) return
      stopVideoSlot(slot)
      setVideoStreamUrl(p => { const n=[...p]; n[slotIdx]=null; return n })
      setVideoStreams(p => { const n=[...p]; n[slotIdx]=null; return n })
      consumeVideoSlot(slot).then(stream => {
        if (retrySeqRef.current[slotIdx] !== seq) {
          if (stream) import('../webrtc/intercom').then(({ stopVideoSlot: s }) => s(slot)).catch(() => {})
          return
        }
        setVideoStreamUrl(p => { const n=[...p]; n[slotIdx] = stream ? (stream as any).toURL() : null; return n })
        setVideoStreams(p => { const n=[...p]; n[slotIdx] = stream || null; return n })
        if (stream) applyVideoVolume(slotIdx, videoVolume[slotIdx], [
          slotIdx === 0 ? stream : videoStreams[0],
          slotIdx === 1 ? stream : videoStreams[1],
        ])
      }).catch(() => {})
    }).catch(() => {})
  }

  useEffect(() => {
    let cleanup: (() => void) | null = null
    import('../webrtc/intercom').then(({ getSocket, onVideoSlotStopped }) => {
      onVideoSlotStopped(slot => {
        const idx = slot - 1
        setVideoStreamUrl(p => { const n=[...p]; n[idx]=null; return n })
        setVideoStreams(p => { const n=[...p]; n[idx]=null; return n })
      })

      const s = getSocket()
      if (!s) return

      const onProducerReady = ({ clientId }: { clientId: string }) => {
        import('../webrtc/intercom').then(({ getVideoRouting }) => {
          const routing = getVideoRouting()
          const v1source = routing.length > 0 ? (routing[0] || 1) : 1
          const v2source = routing.length > 1 ? (routing[1] || 2) : 2
          setTimeout(() => {
            if (showV1Ref.current && clientId === `video-source-${v1source}`) retryVideoSlot(0)
            if (showV2Ref.current && clientId === `video-source-${v2source}`) retryVideoSlot(1)
          }, 300)
        })
      }

      let routingTimer: ReturnType<typeof setTimeout> | null = null
      const onRoutingChanged = () => {
        if (routingTimer) clearTimeout(routingTimer)
        routingTimer = setTimeout(() => {
          routingTimer = null
          if (showV1Ref.current) retryVideoSlot(0)
          if (showV2Ref.current) retryVideoSlot(1)
        }, 500)
      }

      s.on('video:producer:available', onProducerReady)
      s.on('video:routing:update',     onRoutingChanged)
      cleanup = () => {
        s.off('video:producer:available', onProducerReady)
        s.off('video:routing:update',     onRoutingChanged)
        if (routingTimer) clearTimeout(routingTimer)
      }
    })
    return () => { cleanup?.() }
  }, [])

  useEffect(() => {
    import('../webrtc/intercom').then(({ consumeVideoSlot, stopVideoSlot }) => {
      if (showV1) {
        consumeVideoSlot(1).then(stream => {
          setVideoStreamUrl(p => { const n=[...p]; n[0] = stream ? (stream as any).toURL() : null; return n })
          setVideoStreams(p => { const n=[...p]; n[0] = stream || null; return n })
          if (stream) applyVideoVolume(0, videoVolume[0], [stream, videoStreams[1]])
        })
      } else {
        stopVideoSlot(1)
        setVideoStreamUrl(p => { const n=[...p]; n[0] = null; return n })
        setVideoStreams(p => { const n=[...p]; n[0] = null; return n })
      }
    })
  }, [showV1])

  useEffect(() => {
    import('../webrtc/intercom').then(({ consumeVideoSlot, stopVideoSlot }) => {
      if (showV2) {
        consumeVideoSlot(2).then(stream => {
          setVideoStreamUrl(p => { const n=[...p]; n[1] = stream ? (stream as any).toURL() : null; return n })
          setVideoStreams(p => { const n=[...p]; n[1] = stream || null; return n })
          if (stream) applyVideoVolume(1, videoVolume[1], [videoStreams[0], stream])
        })
      } else {
        stopVideoSlot(2)
        setVideoStreamUrl(p => { const n=[...p]; n[1] = null; return n })
        setVideoStreams(p => { const n=[...p]; n[1] = null; return n })
      }
    })
  }, [showV2])

  // Subscribe to real audio levels from server
  useEffect(() => {
    let unsub: (() => void) | null = null
    import('../webrtc/intercom').then(({ subscribeToLevels, getChannelRouting }) => {
      unsub = subscribeToLevels(levels => {
        const rt = getChannelRouting()
        const newLevels = new Array(8).fill(0)
        Object.entries(rt).forEach(([ch, sources]) => {
          const idx = Number(ch) - 1  // channel is 1-based, array is 0-based
          if (idx < 0 || idx > 7) return
          let max = 0
          for (const src of sources) {
            const v = levels[`recv_${src}`] ?? levels[src] ?? 0
            max = Math.max(max, v)
          }
          newLevels[idx] = max > 0 ? Math.min(1, max / 100) : 0
        })
        setMeterLevels(newLevels)
      })
    })
    return () => { unsub?.() }
  }, [])

  useEffect(() => {
    import('../webrtc/intercom').then(({ setToneMode }) => setToneMode(toneActive))
  }, [toneActive])

  // Gate microphone + unmute consumers when talk stops
  useEffect(() => {
    const anyTalkActive = Object.values(talkActive).some(Boolean) || Object.values(talkLatched).some(Boolean)
    const isActive = anyTalkActive || toneActive
    import('../webrtc/intercom').then(({ setMicActive, muteAllConsumers, unmuteActiveConsumers, playLocalTone }) => {
      setMicActive(isActive)
      if (isActive) muteAllConsumers()
      else unmuteActiveConsumers()
      playLocalTone(toneActive && anyTalkActive)
    })
  }, [talkActive, talkLatched, toneActive])

  // ── Talk ──────────────────────────────────────────────────────────────────
  const handleTalkIn  = (k: string, touchCount: number = 1) => {
    if (talkLatched[k as keyof typeof talkLatched]) return
    const ch = parseInt(k.replace('talk', ''))
    setTalkActive(p => ({ ...p, [k]: true }))
    socketEmit?.('client:talking', { isTalking: true, channel: ch })
    // GPO: fires when 2nd top button is pressed (responder system only allows one
    // owner at a time, so touches.length ≥ 2 means another finger is already down)
    if (gpoEnabled && touchCount >= 2 && !gpoFiredRef.current) {
      const top2 = SHUFFLE_ORDERS[shuffleOffset].slice(0, 2).map(i =>
        (['talk1','talk2','talk3','talk4'] as const)[i]
      )
      if (top2.includes(k as any)) {
        gpoFiredRef.current = true
        socketEmit?.('client:gpo:trigger', {})
      }
    }
  }
  const handleTalkOut = (k: string, touchCount: number = 0) => {
    if (talkLatched[k as keyof typeof talkLatched]) return
    const ch = parseInt(k.replace('talk', ''))
    setTalkActive(p => ({ ...p, [k]: false }))
    socketEmit?.('client:talking', { isTalking: false, channel: ch })
    // GPO release: when we drop below 2 simultaneous touches
    if (touchCount < 2 && gpoFiredRef.current) {
      gpoFiredRef.current = false
      socketEmit?.('client:gpo:release', {})
    }
  }
  const handleLatch = (k: string) => {
    const ch = parseInt(k.replace('talk', ''))
    const was = talkLatched[k as keyof typeof talkLatched]
    setTalkLatched(p => ({ ...p, [k]: !was }))
    if (was) {
      setTalkActive(p => ({ ...p, [k]: false }))
      socketEmit?.('client:talking', { isTalking: false, channel: ch })
    } else {
      socketEmit?.('client:talking', { isTalking: true, channel: ch })
    }
    socketEmit?.('client:latched', { isLatched: !was })
  }

  // ── Meter ─────────────────────────────────────────────────────────────────
  const handleMeterTap = (idx: number) => {
    setTapNameIdx(idx); setTimeout(() => setTapNameIdx(null), 2500)
  }
  const handlePairLongPress = (pairIdx: number) => {
    Vibration.vibrate(40); setLogicPairIdx(pairIdx)
  }

  // ── Channel Logic Modal ───────────────────────────────────────────────────
  const renderChannelLogic = () => {
    if (logicPairIdx === null) return null
    const idx1 = logicPairIdx * 2
    const idx2 = logicPairIdx * 2 + 1

    return (
      <Modal
        visible={logicPairIdx !== null}
        transparent
        animationType="slide"
        presentationStyle="overFullScreen"
        onRequestClose={() => setLogicPairIdx(null)}
      >
        <View style={lc.overlay}>
          <View style={lc.header}>
            <View>
              <Text style={lc.title}>CHANNEL LOGIC</Text>
              <Text style={lc.subtitle}>PAIR {logicPairIdx+1} · CH {idx1+1} + CH {idx2+1}</Text>
            </View>
            <TouchableOpacity style={lc.closeBtn} onPress={() => setLogicPairIdx(null)}>
              <Text style={lc.closeTxt}>✕</Text>
            </TouchableOpacity>
          </View>

          <View style={lc.fadersRow}>
            <FaderCtrl idx={idx1} label={`CH ${idx1+1}`}
              gains={gains} setGains={setGains}
              pans={pans} setPans={setPans}
              socketEmit={socketEmit} channelIndex={idx1+1} routing={routing} />
            <View style={lc.divider} />
            <FaderCtrl idx={idx2} label={`CH ${idx2+1}`}
              gains={gains} setGains={setGains}
              pans={pans} setPans={setPans}
              socketEmit={socketEmit} channelIndex={idx2+1} routing={routing} />
          </View>
        </View>
      </Modal>
    )
  }

  // ── Settings Modal ────────────────────────────────────────────────────────
  const renderSettings = () => (
    <Modal visible={isSettingsOpen} animationType="slide" transparent presentationStyle="overFullScreen">
      <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
        <View style={st.overlay}>
          <View style={st.header}>
            <Text style={st.title}>SYSTEM PREFERENCES</Text>
            <TouchableOpacity style={st.closeBtn} onPress={() => setIsSettingsOpen(false)}>
              <Text style={st.closeTxt}>✕</Text>
            </TouchableOpacity>
          </View>
          <ScrollView style={{ flex:1 }} contentContainerStyle={{ padding:20, gap:20 }} keyboardShouldPersistTaps="handled">
            <TouchableOpacity style={st.disconnectBtn} onPress={() => { setIsSettingsOpen(false); onDisconnect() }}>
              <Text style={st.disconnectTxt}>TERMINATE TERMINAL LINK</Text>
              <Text style={{ color:RED_C, fontSize:18 }}>↩</Text>
            </TouchableOpacity>
            <View style={st.section}>
              <Text style={st.sectionLabel}>DISPLAY ENGINE</Text>
              <View style={st.row}>
                <Text style={st.rowLabel}>Flip UI (Rotation)</Text>
                <Switch value={isRotated} onValueChange={setIsRotated}
                  trackColor={{ false:BORDER, true:ACCENT }} thumbColor="#fff" />
              </View>
            </View>
            <View style={st.section}>
              <Text style={st.sectionLabel}>AUDIO TEST</Text>
              <View style={st.row}>
                <View style={{ flex: 1 }}>
                  <Text style={st.rowLabel}>Tone Test Mode</Text>
                  <Text style={{ color: '#71717a', fontSize: 10, marginTop: 2 }}>
                    {toneActive
                      ? 'ACTIVE — press a TB button to send tone on that channel'
                      : 'Press a TB to send a test signal on that channel only'}
                  </Text>
                </View>
                <Switch
                  value={toneActive}
                  onValueChange={v => setToneActive(v)}
                  trackColor={{ false: BORDER, true: GREEN }}
                  thumbColor="#fff"
                />
              </View>
            </View>
            <View style={st.section}>
              <Text style={st.sectionLabel}>GPI / GPO</Text>
              <View style={st.row}>
                <View style={{ flex: 1 }}>
                  <Text style={st.rowLabel}>GPO Mode</Text>
                  <Text style={{ color: '#71717a', fontSize: 10, marginTop: 2 }}>
                    {gpoEnabled
                      ? 'AKTIV — tryk begge øverste TB-knapper samtidig for at sende GPO-signal'
                      : 'Tryk begge øverste TB-knapper samtidig for at sende et GPO-signal til hosten'}
                  </Text>
                </View>
                <Switch
                  value={gpoEnabled}
                  onValueChange={v => setGpoEnabled(v)}
                  trackColor={{ false: BORDER, true: ACCENT }}
                  thumbColor="#fff"
                />
              </View>
            </View>
            <View style={st.section}>
              <Text style={st.sectionLabel}>BUTTON NAMES</Text>
              {(['talk1','talk2','talk3','talk4'] as const).map((k,i) => (
                <View key={k} style={st.nameRow}>
                  <Text style={st.nameLabel}>Button {i+1}</Text>
                  <TextInput style={st.nameInput} value={editedNames[k]}
                    onChangeText={v => setEditedNames(p => ({ ...p, [k]: v }))}
                    autoCapitalize="words" returnKeyType="done"
                    onSubmitEditing={Keyboard.dismiss} placeholderTextColor="#52525b" />
                </View>
              ))}
            </View>
          </ScrollView>
          <View style={st.footer}>
            <TouchableOpacity style={st.resetBtn} onPress={() =>
              Alert.alert('Reset','Reset all settings to default?',[
                { text:'Cancel', style:'cancel' },
                { text:'Reset', style:'destructive', onPress: () => {
                  const d = { talk1:'Producer', talk2:'Talk 2', talk3:'Talk 3', talk4:'Talk 4' }
                  setTalkNames(d); setEditedNames(d); setShuffleOffset(0); setIsRotated(false)
                  setGains(new Array(8).fill(80))
                  setPans(new Array(8).fill(0))
                }}])}>
              <Text style={st.resetTxt}>DEFAULT</Text>
            </TouchableOpacity>
            <TouchableOpacity style={st.saveBtn} onPress={() => { setTalkNames({...editedNames}); setIsSettingsOpen(false) }}>
              <Text style={st.saveTxt}>SAVE & CLOSE</Text>
            </TouchableOpacity>
          </View>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  )

  const allTalk = [
    { key:'talk1' as const, name:talkNames.talk1 },
    { key:'talk2' as const, name:talkNames.talk2 },
    { key:'talk3' as const, name:talkNames.talk3 },
    { key:'talk4' as const, name:talkNames.talk4 },
  ]
  const orderedTalk = SHUFFLE_ORDERS[shuffleOffset].map(i => allTalk[i])

  // ── Landscape video overlay (auto-fullscreen when rotated) ────────────────
  const renderLandscapeVideo = () => {
    if (!isLandscape || (!showV1 && !showV2)) return null
    return (
      <Modal visible animationType="none" transparent={false} statusBarTranslucent>
        <View style={{ flex:1, flexDirection:'row', backgroundColor:'#000' }}>
          {showV1 && (
            <Pressable style={{ flex:1 }} onPress={() => handleVideoTap(0)}>
              {videoStreamUrl[0]
                ? <RTCView streamURL={videoStreamUrl[0]} style={StyleSheet.absoluteFill} objectFit="contain" />
                : <Text style={[s.videoOff, { position:'absolute', top:'50%', alignSelf:'center' }]}>NO SIGNAL</Text>
              }
              <Text style={[s.videoBadge, { color:RED_C, top:16, left:16, fontSize:9 }]}>● PGM 01</Text>
              {showVideoControls[0] && videoStreamUrl[0] && (
                <View style={[s.volRow, { bottom:24, left:16, right:16 }]}>
                  <Text style={s.volIcon}>{videoVolume[0]===0?'🔇':'🔊'}</Text>
                  <VideoVolumeSlider volume={videoVolume[0]} onChange={v => {
                    setVideoVolume(p=>{const n=[...p];n[0]=v;return n})
                    applyVideoVolume(0, v)
                  }} />
                </View>
              )}
            </Pressable>
          )}
          {showV1 && showV2 && <View style={{ width:1, backgroundColor:BORDER }} />}
          {showV2 && (
            <Pressable style={{ flex:1 }} onPress={() => handleVideoTap(1)}>
              {videoStreamUrl[1]
                ? <RTCView streamURL={videoStreamUrl[1]} style={StyleSheet.absoluteFill} objectFit="contain" />
                : <Text style={[s.videoOff, { position:'absolute', top:'50%', alignSelf:'center' }]}>NO SIGNAL</Text>
              }
              <Text style={[s.videoBadge, { color:'#3b82f6', top:16, left:8, fontSize:9 }]}>● PGM 02</Text>
              {showVideoControls[1] && videoStreamUrl[1] && (
                <View style={[s.volRow, { bottom:24, left:8, right:20 }]}>
                  <Text style={s.volIcon}>{videoVolume[1]===0?'🔇':'🔊'}</Text>
                  <VideoVolumeSlider volume={videoVolume[1]} onChange={v => {
                    setVideoVolume(p=>{const n=[...p];n[1]=v;return n})
                    applyVideoVolume(1, v)
                  }} />
                </View>
              )}
            </Pressable>
          )}
        </View>
      </Modal>
    )
  }

  return (
    <SafeAreaView style={[s.root, isRotated && { transform:[{rotate:'180deg'}] }]}>
      {/* Hidden RTCViews activate native audio playback for each incoming stream */}
      {audioStreams.map((stream, i) => (
        <RTCView key={stream.id ?? i} streamURL={stream.toURL()} style={{ width: 0, height: 0 }} />
      ))}

      <View style={s.watermark} pointerEvents="none">
        <Text style={s.watermarkText}>
          {'EASYC'}
          <Text style={s.watermarkAccent}>O</Text>
          {'M M'}
          <Text style={s.watermarkAccent}>O</Text>
          {'BILE'}
        </Text>
      </View>

      {renderChannelLogic()}
      {renderSettings()}
      {renderLandscapeVideo()}

      {/* TALLY BLOCK — rendered before topBar so it sits behind content in z-order */}
      {tallyState !== 'off' && meterSectionBottom > 0 && (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: 0, left: 0, right: 0,
            height: meterSectionBottom,
            backgroundColor: tallyState === 'program' ? '#dc2626' : '#d97706',
            borderBottomLeftRadius: 20,
            borderBottomRightRadius: 20,
          }}
        />
      )}

      {/* TOP BAR — transparent background when tally active so tally color shows through */}
      <View style={[s.topBar, tallyState !== 'off' && { backgroundColor: 'transparent', borderBottomColor: 'rgba(255,255,255,0.15)' }]}>
        <View>
          <Text style={s.liveLabel}>⚡ LIVE_NODE</Text>
          <Text style={s.stationName}>{stationName}</Text>
          {tallyState !== 'off' && (
            <Text style={{ color: '#fff', fontWeight: '900', fontSize: 11, letterSpacing: 2.5, marginTop: 2 }}>
              {tallyState === 'program' ? '● ON AIR' : '● STAND BY'}
            </Text>
          )}
        </View>
        <View style={s.topBtns}>
          <TouchableOpacity style={[s.topBtn, shuffleOffset!==0 && s.topBtnOn]}
            onPress={() => setShuffleOffset(p=>(p+1)%4)}>
            <Text style={[s.topBtnTxt, shuffleOffset!==0 && s.topBtnTxtOn]}>⇄</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[s.topBtnWide, showV1 && s.topBtnV1]} onPress={() => setShowV1(p=>!p)}>
            <Text style={[s.topBtnWideTxt, showV1 && s.topBtnWideTxtOn]}>V1</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[s.topBtnWide, showV2 && s.topBtnV2]} onPress={() => setShowV2(p=>!p)}>
            <Text style={[s.topBtnWideTxt, showV2 && { color:'#fff' }]}>V2</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.topBtn} onPress={() => { setEditedNames({...talkNames}); setIsSettingsOpen(true) }}>
            <Text style={s.topBtnTxt}>⚙</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* VIDEO – portrait only (landscape is handled by the Modal above) */}
      {(showV1 || showV2) && !isLandscape && (
        <View style={[s.videoRow, { height: (showV1 && showV2) ? 120 : 210 }]}>
          {showV1 && (
            <Pressable style={[s.videoBox, {flex:1}]} onPress={() => handleVideoTap(0)}>
              {videoStreamUrl[0]
                ? <RTCView streamURL={videoStreamUrl[0]} style={StyleSheet.absoluteFill} objectFit="contain" />
                : <Text style={s.videoOff}>NO SIGNAL</Text>
              }
              <Text style={[s.videoBadge,{color:RED_C}]}>● PGM 01</Text>
              {showVideoControls[0] && videoStreamUrl[0] && (
                <View style={s.volRow}>
                  <Text style={s.volIcon}>{videoVolume[0]===0?'🔇':'🔊'}</Text>
                  <VideoVolumeSlider volume={videoVolume[0]} onChange={v => {
                    setVideoVolume(p=>{const n=[...p];n[0]=v;return n})
                    applyVideoVolume(0, v)
                  }} />
                </View>
              )}
            </Pressable>
          )}
          {showV2 && (
            <Pressable style={[s.videoBox,{flex:1,borderLeftWidth:showV1?1:0,borderLeftColor:BORDER}]} onPress={() => handleVideoTap(1)}>
              {videoStreamUrl[1]
                ? <RTCView streamURL={videoStreamUrl[1]} style={StyleSheet.absoluteFill} objectFit="contain" />
                : <Text style={s.videoOff}>NO SIGNAL</Text>
              }
              <Text style={[s.videoBadge,{color:'#3b82f6'}]}>● PGM 02</Text>
              {showVideoControls[1] && videoStreamUrl[1] && (
                <View style={s.volRow}>
                  <Text style={s.volIcon}>{videoVolume[1]===0?'🔇':'🔊'}</Text>
                  <VideoVolumeSlider volume={videoVolume[1]} onChange={v => {
                    setVideoVolume(p=>{const n=[...p];n[1]=v;return n})
                    applyVideoVolume(1, v)
                  }} />
                </View>
              )}
            </Pressable>
          )}
        </View>
      )}

      {/* PORTRAIT FULLSCREEN VIDEO MODAL (double-tap) */}
      {videoFullscreen !== null && (
        <Modal visible animationType="fade" transparent presentationStyle="overFullScreen">
          <View style={s.fsOverlay}>
            {videoStreamUrl[videoFullscreen]
              ? <RTCView streamURL={videoStreamUrl[videoFullscreen]!} style={StyleSheet.absoluteFill} objectFit="contain" />
              : <Text style={[s.videoOff,{position:'absolute',top:'50%',alignSelf:'center'}]}>NO SIGNAL</Text>
            }
            <Text style={[s.videoBadge, videoFullscreen===0?{color:RED_C}:{color:'#3b82f6'}, {top:56,fontSize:9}]}>
              ● {videoFullscreen===0?'PGM 01':'PGM 02'}
            </Text>
            <Pressable style={StyleSheet.absoluteFill} onPress={() =>
              setShowVideoControls(p => ({ ...p, [videoFullscreen]: !p[videoFullscreen] }))
            } />
            {showVideoControls[videoFullscreen] && videoStreamUrl[videoFullscreen] && (
              <View style={s.fsVolRow}>
                <Text style={s.volIcon}>{videoVolume[videoFullscreen]===0?'🔇':'🔊'}</Text>
                <VideoVolumeSlider volume={videoVolume[videoFullscreen]} onChange={v => {
                  const slot = videoFullscreen
                  setVideoVolume(p=>{const n=[...p];n[slot]=v;return n})
                  applyVideoVolume(slot, v)
                }} />
              </View>
            )}
            <TouchableOpacity style={s.fsClose} onPress={() => setVideoFullscreen(null)}>
              <Text style={s.fsCloseTxt}>✕</Text>
            </TouchableOpacity>
          </View>
        </Modal>
      )}

      {/* METERS */}
      <View style={s.meterSection} onLayout={e => {
        const { y, height } = e.nativeEvent.layout
        setMeterSectionBottom(y + height + 20)
      }}>
        <View style={s.meterGrid}>
          {[0,1,2,3].map(pairIdx => {
            return (
              <View key={pairIdx} style={s.meterPair}>
                {[0,1].map(offset => {
                  const idx = pairIdx*2+offset
                  const lvl = meterLevels[idx]
                  const hot = lvl > 0.7
                  return (
                    <TouchableOpacity
                      key={idx}
                      style={s.meterCh}
                      onPress={() => handleMeterTap(idx)}
                      onLongPress={() => handlePairLongPress(pairIdx)}
                      delayLongPress={400}
                      activeOpacity={0.6}
                      hitSlop={{ top:4, left:4, right:4, bottom:4 }}
                    >
                      <View style={s.meterBar}>
                        <View style={[s.meterFill, { height:`${Math.max(3,lvl*100)}%` }, hot ? s.meterHot : s.meterGreen]} />
                        {tapNameIdx===idx && channelNames[idx+1] && (
                          <View style={s.nameOverlay}>
                            <Text style={s.nameOverlayTxt} numberOfLines={2}>{channelNames[idx+1]}</Text>
                          </View>
                        )}
                      </View>
                      <Text style={s.meterChLabel}>CH{idx+1}</Text>
                    </TouchableOpacity>
                  )
                })}
              </View>
            )
          })}
        </View>
        <Text style={s.meterHint}>HOLD METER FOR LOGIC SETTINGS</Text>
      </View>

      {/* TALK BUTTONS */}
      <View style={s.talkSection}>
        <View style={s.talkRow}>
          {orderedTalk.slice(0,2).map(({key,name}) => (
            <TalkButton key={key} talkKey={key} name={name}
              active={talkActive[key]} latched={talkLatched[key]}
              toneMode={toneActive}
              onIn={handleTalkIn} onOut={handleTalkOut} onLatch={handleLatch} />
          ))}
        </View>
        <View style={s.talkRow}>
          {orderedTalk.slice(2,4).map(({key,name}) => (
            <TalkButton key={key} talkKey={key} name={name}
              active={talkActive[key]} latched={talkLatched[key]}
              toneMode={toneActive}
              onIn={handleTalkIn} onOut={handleTalkOut} onLatch={handleLatch} />
          ))}
        </View>
      </View>

    </SafeAreaView>
  )
}

// ── Video volume slider ───────────────────────────────────────────────────────
function VideoVolumeSlider({ volume, onChange }: { volume: number; onChange: (v: number) => void }) {
  const widthRef = useRef(200)
  const startX   = useRef(0)
  const startVol = useRef(volume)
  return (
    <View
      style={{ flex: 1, height: 24, justifyContent: 'center' }}
      onLayout={e => { widthRef.current = e.nativeEvent.layout.width }}
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder ={() => true}
      onResponderGrant={e => { startX.current = e.nativeEvent.pageX; startVol.current = volume }}
      onResponderMove={e => {
        const dx = e.nativeEvent.pageX - startX.current
        const v  = Math.max(0, Math.min(100, Math.round(startVol.current + (dx / widthRef.current) * 100)))
        onChange(v)
      }}
    >
      <View style={{ height: 3, backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: 2 }}>
        <View style={{ height: 3, width: `${volume}%`, backgroundColor: volume === 0 ? RED_C : ACCENT, borderRadius: 2 }} />
      </View>
      <View style={{
        position: 'absolute', left: `${volume}%` as any, marginLeft: -7, top: 5,
        width: 14, height: 14, borderRadius: 7, backgroundColor: '#fff',
        shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }
      }} />
    </View>
  )
}

// ── Fader – standalone component with its own drag refs ───────────────────────
interface FaderProps {
  idx: number; label: string
  gains: number[]
  setGains: React.Dispatch<React.SetStateAction<number[]>>
  pans: number[]
  setPans: React.Dispatch<React.SetStateAction<number[]>>
  socketEmit?: (event: string, data: any) => void
  channelIndex: number
  routing?: Record<number, string[]>
}
function FaderCtrl({ idx, label, gains, setGains, pans, setPans, socketEmit, channelIndex, routing }: FaderProps) {
  const startY   = useRef(0)
  const startVal = useRef(80)
  const containerRef = useRef<any>(null)
  const containerTop = useRef(-1)
  const prevGain = useRef(80)
  const gain = gains[idx]
  const pan  = pans[idx]
  const FH = 160, TH = 32, TRACK = FH - TH
  const thumbTop = TRACK - Math.round((gain / 100) * TRACK)

  const getBridgeId = () => {
    const rt = routing || {}
    const entries = Object.entries(rt).sort((a, b) => Number(a[0]) - Number(b[0]))
    const slotEntry = entries[idx]
    const sources = slotEntry ? slotEntry[1] : []
    return sources[0] || null
  }

  const emitGain = (g: number) => {
    const bridgeId = getBridgeId()
    socketEmit?.('client:gain', { channel: channelIndex, gain: g / 100, bridgeId })
    import('../webrtc/intercom').then(({ setLocalChannelGain }) => {
      setLocalChannelGain(channelIndex, g / 100)
    })
  }

  const toggleMute = () => {
    if (gain === 0) {
      const restore = prevGain.current > 0 ? prevGain.current : 80
      setGains(prev => { const n = [...prev]; n[idx] = restore; return n })
      emitGain(restore)
    } else {
      prevGain.current = gain
      setGains(prev => { const n = [...prev]; n[idx] = 0; return n })
      emitGain(0)
    }
  }

  const emitPan = (p: number) => {
    const bridgeId = getBridgeId()
    socketEmit?.('client:pan', { channel: channelIndex, pan: p, bridgeId })
  }

  const dbLabel = gain === 0 ? '-∞' : gain >= 100 ? '+6' : `${Math.round((gain/100)*18-12)}dB`

  return (
    <View style={lc.faderCol}>
      <Text style={lc.faderLabel}>{label}</Text>
      <Text style={lc.dbText}>{dbLabel}</Text>

      <View
        ref={containerRef}
        style={{ width: 60, height: FH, position: 'relative', alignItems: 'center' }}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onLayout={() => {
          containerRef.current?.measureInWindow((_x: number, y: number) => {
            containerTop.current = y
          })
        }}
        onResponderGrant={e => {
          startY.current   = e.nativeEvent.pageY
          startVal.current = gains[idx]
        }}
        onResponderMove={e => {
          if (containerTop.current >= 0) {
            const relY = e.nativeEvent.pageY - containerTop.current
            const v = Math.round(Math.max(0, Math.min(100, (1 - Math.max(0, Math.min(TRACK, relY)) / TRACK) * 100)))
            setGains(prev => { const n = [...prev]; n[idx] = v; return n })
          } else {
            const dy = startY.current - e.nativeEvent.pageY
            const v = Math.max(0, Math.min(100, startVal.current + (dy / TRACK) * 100))
            setGains(prev => { const n = [...prev]; n[idx] = Math.round(v); return n })
          }
        }}
        onResponderRelease={() => { emitGain(gains[idx]) }}
      >
        <View style={{ position:'absolute', top:0, bottom:0, width:6, borderRadius:3, backgroundColor:'#0a0a0a' }} />
        <View style={{ position:'absolute', bottom:0, width:6, borderRadius:3, backgroundColor:ACCENT, opacity:0.5, height: gain === 0 ? 0 : (gain/100)*TRACK + TH/2 }} />
        <View style={[lc.thumb, { top: thumbTop }]}>
          {[0,1,2].map(i => <View key={i} style={[lc.thumbLine, { top: 10+i*6 }]} />)}
          <View style={[lc.thumbAccent, { top: TH/2-0.5 }]} />
        </View>
      </View>

      {/* MUTE */}
      <TouchableOpacity
        onPress={toggleMute}
        style={{ marginTop: 6, paddingVertical: 4, paddingHorizontal: 10, borderRadius: 6,
          backgroundColor: gain === 0 ? '#ef4444' : '#27272a',
          borderWidth: 1, borderColor: gain === 0 ? '#ef4444' : '#3f3f46' }}
      >
        <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700', letterSpacing: 1 }}>
          {gain === 0 ? 'MUTED' : 'MUTE'}
        </Text>
      </TouchableOpacity>

      {/* PAN */}
      <Text style={lc.panTitle}>PAN</Text>
      <View style={lc.panRow}>
        {([-1, 0, 1] as const).map(v => (
          <TouchableOpacity
            key={v}
            style={[lc.panBtn, pan === v && lc.panBtnOn]}
            onPress={() => { setPans(prev => { const n=[...prev]; n[idx]=v; return n }); emitPan(v) }}
          >
            <Text style={[lc.panTxt, pan === v && lc.panTxtOn]}>
              {v === -1 ? '◀' : v === 0 ? '●' : '▶'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  )
}

interface TalkBtnProps {
  talkKey:string; name:string; active:boolean; latched:boolean; toneMode?: boolean
  onIn:(k:string, touches:number)=>void; onOut:(k:string, touches:number)=>void; onLatch:(k:string)=>void
}
function TalkButton({ talkKey, name, active, latched, toneMode, onIn, onOut, onLatch }: TalkBtnProps) {
  const isOn = active || latched

  return (
    <View style={s.talkCell}>
      {/* Main talk surface — use responder system for reliable hold-to-talk on iOS */}
      <View
        style={[s.talkBtn, isOn && s.talkBtnOn]}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => false}
        onResponderGrant={(e) => {
          if (!latched) onIn(talkKey, e.nativeEvent.touches.length)
        }}
        onResponderRelease={(e) => {
          if (latched) onLatch(talkKey)
          else onOut(talkKey, e.nativeEvent.touches.length)
        }}
        onResponderTerminate={(e) => {
          if (!latched) onOut(talkKey, e.nativeEvent.touches.length)
        }}
      >
        <View style={s.talkGloss} pointerEvents="none" />
        <Text style={s.micIcon}>{toneMode ? '〜' : '🎙'}</Text>
        <Text style={[s.talkName, isOn && s.talkNameOn]}>{name}</Text>
        {toneMode && <Text style={s.toneBadge}>TONE</Text>}
      </View>

      {/* Latch anchor */}
      <Pressable
        style={[s.latchBtn, latched && s.latchBtnOn]}
        onPress={() => onLatch(talkKey)}
        hitSlop={{ top:12, left:12, right:12, bottom:12 }}
      >
        <Text style={[s.latchIcon, latched && s.latchIconOn]}>⚓</Text>
      </Pressable>
    </View>
  )
}

// ─── Main styles ──────────────────────────────────────────────────────────────
const TALK=138, LATCH=30

const s = StyleSheet.create({
  root:           { flex:1, backgroundColor:BG },
  watermark:      { position:'absolute', top:0, left:0, right:0, bottom:0, zIndex:0, alignItems:'center', justifyContent:'center', opacity:0.07 },
  watermarkText:  { color:'#fff', fontSize:28, fontWeight:'900', fontStyle:'italic', letterSpacing:3 },
  watermarkAccent:{ color:'#f97316' },
  topBar:         { flexDirection:'row', alignItems:'center', justifyContent:'space-between', paddingHorizontal:16, paddingTop:6, paddingBottom:10, backgroundColor:CARD, borderBottomWidth:1, borderBottomColor:BORDER },
  liveLabel:      { color:GREEN, fontSize:8, fontWeight:'900', letterSpacing:2 },
  stationName:    { color:'#fff', fontSize:14, fontWeight:'900', fontStyle:'italic', letterSpacing:1 },
  topBtns:        { flexDirection:'row', gap:7, alignItems:'center' },
  topBtn:         { width:44, height:44, borderRadius:12, backgroundColor:BG, borderWidth:1, borderColor:BORDER, alignItems:'center', justifyContent:'center' },
  topBtnOn:       { backgroundColor:'#1c0d00', borderColor:ACCENT },
  topBtnTxt:      { color:'#71717a', fontSize:18 },
  topBtnTxtOn:    { color:ACCENT },
  topBtnWide:     { width:44, height:44, borderRadius:12, backgroundColor:BG, borderWidth:1, borderColor:BORDER, alignItems:'center', justifyContent:'center' },
  topBtnV1:       { backgroundColor:'#450a0a', borderColor:RED_C },
  topBtnV2:       { backgroundColor:'#172554', borderColor:'#3b82f6' },
  topBtnWideTxt:  { color:'#71717a', fontSize:14, fontWeight:'900' },
  topBtnWideTxtOn:{ color:'#fff' },
  videoRow:       { flexDirection:'row', borderBottomWidth:1, borderBottomColor:BORDER },
  videoBox:       { backgroundColor:'#000', alignItems:'center', justifyContent:'center' },
  videoBadge:     { position:'absolute', top:6, left:8, fontSize:7, fontWeight:'900', letterSpacing:2 },
  videoOff:       { color:'#27272a', fontSize:11, fontWeight:'900', letterSpacing:4 },
  volRow:         { position:'absolute', bottom:6, left:8, right:8, flexDirection:'row', alignItems:'center', gap:6 },
  volIcon:        { fontSize:11 },
  fsOverlay:      { flex:1, backgroundColor:'#000' },
  fsVolRow:       { position:'absolute', bottom:40, left:20, right:20, flexDirection:'row', alignItems:'center', gap:10 },
  fsClose:        { position:'absolute', top:52, right:16, width:38, height:38, borderRadius:19, backgroundColor:'rgba(0,0,0,0.65)', borderWidth:1, borderColor:'rgba(255,255,255,0.2)', alignItems:'center', justifyContent:'center' },
  fsCloseTxt:     { color:'#fff', fontSize:15, fontWeight:'700' },
  meterSection:   { paddingHorizontal:14, paddingTop:14 },
  meterGrid:      { flexDirection:'row', gap:6 },
  meterPair:      { flex:1, flexDirection:'row', gap:4, backgroundColor:'rgba(0,0,0,0.3)', borderRadius:10, padding:5, borderWidth:1, borderColor:BORDER, height:88 },
  meterCh:        { flex:1, alignItems:'center', gap:3 },
  meterBar:       { flex:1, width:'100%', backgroundColor:'#09090b', borderRadius:4, overflow:'hidden', justifyContent:'flex-end' },
  meterFill:      { width:'100%', position:'absolute', bottom:0, borderRadius:3 },
  meterGreen:     { backgroundColor:GREEN },
  meterHot:       { backgroundColor:RED_C },
  nameOverlay:    { ...StyleSheet.absoluteFill, backgroundColor:'rgba(0,0,0,0.88)', alignItems:'center', justifyContent:'center', padding:2 },
  nameOverlayTxt: { color:'#fff', fontSize:6, fontWeight:'900', textAlign:'center' },
  meterChLabel:   { color:'#3f3f46', fontSize:6, fontWeight:'900' },
  meterHint:      { color:'#27272a', fontSize:7, fontWeight:'900', letterSpacing:3, textAlign:'center', marginTop:8, fontStyle:'italic' },
  talkSection:    { position:'absolute', bottom:0, left:0, right:0, paddingBottom:20, paddingHorizontal:14, gap:12 },
  talkRow:        { flexDirection:'row', justifyContent:'center', gap:16 },
  talkCell:       { width:TALK+LATCH/2, height:TALK+LATCH/2, alignItems:'center', justifyContent:'flex-end' },
  talkBtn:        {
                    width:TALK, height:TALK, borderRadius:TALK/2,
                    backgroundColor:'#48484f',
                    alignItems:'center', justifyContent:'center', gap:5,
                    shadowColor:'#000', shadowOpacity:0.9, shadowRadius:22, shadowOffset:{width:0,height:10},
                    elevation:16,
                    borderWidth:2,
                    borderTopColor:'rgba(255,255,255,0.30)',
                    borderLeftColor:'rgba(255,255,255,0.20)',
                    borderBottomColor:'rgba(0,0,0,0.75)',
                    borderRightColor:'rgba(0,0,0,0.60)',
                  },
  talkBtnOn:      {
                    backgroundColor:'#ea6010',
                    shadowColor:ACCENT, shadowOpacity:0.7, shadowRadius:32,
                    borderTopColor:'rgba(255,210,120,0.55)',
                    borderLeftColor:'rgba(255,200,100,0.40)',
                    borderBottomColor:'rgba(120,40,0,0.80)',
                    borderRightColor:'rgba(140,50,0,0.65)',
                  },
  talkGloss:      {
                    position:'absolute', top:6, left:14, right:14, height:TALK*0.32,
                    borderRadius:TALK/2,
                    backgroundColor:'rgba(255,255,255,0.13)',
                  },
  micIcon:        { fontSize: 34 },
  talkName:       { color:'#a1a1aa', fontSize:11, fontWeight:'900', letterSpacing:1, textTransform:'uppercase' },
  talkNameOn:     { color:'#fff' },
  latchBtn:       { position:'absolute', top:0, right:0, width:LATCH, height:LATCH, borderRadius:LATCH/2, backgroundColor:'#18181b', borderWidth:1.5, borderColor:'rgba(255,255,255,0.18)', alignItems:'center', justifyContent:'center', shadowColor:'#000', shadowOpacity:0.8, shadowRadius:6, shadowOffset:{width:0,height:2} },
  latchBtnOn:     { backgroundColor:'#fff', borderColor:ACCENT, shadowColor:ACCENT, shadowOpacity:0.6, shadowRadius:10 },
  latchIcon:      { fontSize:11, color:'#71717a' },
  latchIconOn:    { color:'#ea580c' },
  toneBadge:      { position:'absolute', top:8, right:10, color:'#22c55e', fontSize:6, fontWeight:'900', letterSpacing:1 },
})

// ─── Channel Logic styles ─────────────────────────────────────────────────────
const lc = StyleSheet.create({
  overlay:    { flex:1, backgroundColor:'rgba(0,0,0,0.96)', padding:24, paddingTop:60, gap:20 },
  header:     { flexDirection:'row', justifyContent:'space-between', alignItems:'flex-start' },
  title:      { color:'#fff', fontSize:20, fontWeight:'900', fontStyle:'italic', letterSpacing:1 },
  subtitle:   { color:'#52525b', fontSize:9, letterSpacing:3, marginTop:4 },
  closeBtn:   { width:36, height:36, borderRadius:18, backgroundColor:CARD, borderWidth:1, borderColor:BORDER, alignItems:'center', justifyContent:'center' },
  closeTxt:   { color:'#fff', fontSize:14, fontWeight:'700' },
  fadersRow:  { flex:1, flexDirection:'row', justifyContent:'space-around', alignItems:'flex-start', backgroundColor:'rgba(255,255,255,0.03)', borderRadius:24, borderWidth:1, borderColor:BORDER, padding:24 },
  divider:    { width:1, backgroundColor:BORDER, alignSelf:'stretch', marginHorizontal:8 },
  faderCol:   { alignItems:'center', gap:10 },
  faderLabel: { color:'#52525b', fontSize:9, fontWeight:'900', letterSpacing:2, textTransform:'uppercase' },
  dbText:     { color:ACCENT, fontSize:11, fontFamily:Platform.OS==='ios'?'Menlo':'monospace', fontWeight:'700' },
  thumb:      { position:'absolute', left:2, width:36, height:32, borderRadius:8, backgroundColor:'#2a2a2a', borderWidth:1, borderColor:'rgba(255,255,255,0.2)' },
  thumbLine:  { position:'absolute', left:6, right:6, height:1, backgroundColor:'rgba(255,255,255,0.12)' },
  thumbAccent:{ position:'absolute', left:6, right:6, height:1, backgroundColor:ACCENT },
  panTitle:   { color:'#3f3f46', fontSize:8, fontWeight:'900', letterSpacing:2 },
  panRow:     { flexDirection:'row', gap:8 },
  panBtn:     { width:36, height:36, borderRadius:9, backgroundColor:'rgba(255,255,255,0.04)', borderWidth:1, borderColor:'rgba(255,255,255,0.08)', alignItems:'center', justifyContent:'center' },
  panBtnOn:   { backgroundColor:ACCENT, borderColor:ACCENT },
  panTxt:     { color:'rgba(255,255,255,0.4)', fontSize:14, fontWeight:'900' },
  panTxtOn:   { color:'#000' },
})

// ─── Settings styles ──────────────────────────────────────────────────────────
const st = StyleSheet.create({
  overlay:      { flex:1, backgroundColor:'rgba(0,0,0,0.98)' },
  header:       { flexDirection:'row', justifyContent:'space-between', alignItems:'center', padding:24, paddingTop:60, borderBottomWidth:1, borderBottomColor:BORDER, backgroundColor:'rgba(24,24,27,0.5)' },
  title:        { color:'#fff', fontSize:17, fontWeight:'900', fontStyle:'italic', letterSpacing:1 },
  closeBtn:     { width:32, height:32, borderRadius:16, backgroundColor:CARD, alignItems:'center', justifyContent:'center' },
  closeTxt:     { color:'#fff', fontSize:12, fontWeight:'700' },
  disconnectBtn:{ flexDirection:'row', alignItems:'center', justifyContent:'space-between', backgroundColor:'rgba(239,68,68,0.08)', borderWidth:1, borderColor:'rgba(239,68,68,0.3)', borderRadius:14, padding:20 },
  disconnectTxt:{ color:RED_C, fontWeight:'900', fontSize:11, letterSpacing:2 },
  section:      { gap:10 },
  sectionLabel: { color:'#52525b', fontSize:9, fontWeight:'900', letterSpacing:3 },
  row:          { flexDirection:'row', alignItems:'center', justifyContent:'space-between', backgroundColor:CARD, borderRadius:14, padding:16, borderWidth:1, borderColor:BORDER },
  rowLabel:     { color:'#e4e4e7', fontSize:13, fontWeight:'700' },
  nameRow:      { flexDirection:'row', alignItems:'center', gap:12 },
  nameLabel:    { color:'#52525b', fontSize:9, fontWeight:'900', width:50, letterSpacing:1 },
  nameInput:    { flex:1, backgroundColor:BG, borderWidth:1, borderColor:BORDER, borderRadius:12, paddingHorizontal:14, paddingVertical:12, color:'#fff', fontSize:13, fontWeight:'900' },
  footer:       { padding:20, borderTopWidth:1, borderTopColor:BORDER, gap:10 },
  resetBtn:     { padding:16, borderRadius:14, backgroundColor:CARD, borderWidth:1, borderColor:BORDER, alignItems:'center' },
  resetTxt:     { color:'#71717a', fontWeight:'900', fontSize:11, letterSpacing:3 },
  saveBtn:      { padding:20, borderRadius:14, backgroundColor:ACCENT, alignItems:'center' },
  saveTxt:      { color:'#fff', fontWeight:'900', fontSize:12, letterSpacing:3 },
})
