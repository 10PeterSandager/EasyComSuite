// screens/LoginScreen.tsx
import React, { useState, useRef, useEffect } from 'react'
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, SafeAreaView, Modal, ScrollView,
  Switch, Platform, KeyboardAvoidingView,
  TouchableWithoutFeedback, Keyboard, Linking,
} from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import type { ClientInfo } from '../App'

const STORAGE_KEYS = {
  hostIp:          'easycom_host_ip',
  hostPort:        'easycom_host_port',
  sessionPassword: 'easycom_session_pw',
  ssl:             'easycom_ssl',
} as const

const ACCENT  = '#f97316'
const BG      = '#0c0c0c'
const CARD    = '#141414'
const BORDER  = '#1f1f1f'

type Props = {
  clients:   ClientInfo[]
  loading:   boolean
  error:     string
  onSearch:  (ip: string, sessionPassword: string, ssl: boolean, port?: string) => void
  onConnect: (client: ClientInfo, pin: string) => void
  onOpenWithoutConnection?: () => void
}

export default function LoginScreen({
  clients, loading, error, onSearch, onConnect, onOpenWithoutConnection,
}: Props) {
  const [hostIp,          setHostIp]          = useState('192.168.1.23')
  const [hostPort,        setHostPort]        = useState('3000')
  const [sessionPassword, setSessionPassword] = useState('')
  const [ssl,             setSsl]             = useState(false)
  const [settingsLoaded,  setSettingsLoaded]  = useState(false)
  const [showSettings,    setShowSettings]    = useState(false)
  const [showPrivacy,     setShowPrivacy]     = useState(false)

  // Load persisted settings on first mount
  useEffect(() => {
    Promise.all([
      AsyncStorage.getItem(STORAGE_KEYS.hostIp),
      AsyncStorage.getItem(STORAGE_KEYS.hostPort),
      AsyncStorage.getItem(STORAGE_KEYS.sessionPassword),
      AsyncStorage.getItem(STORAGE_KEYS.ssl),
    ]).then(([ip, port, pw, sslVal]) => {
      if (ip)   setHostIp(ip)
      if (port) setHostPort(port)
      if (pw !== null) setSessionPassword(pw ?? '')
      if (sslVal === 'true') setSsl(true)
      setSettingsLoaded(true)
    }).catch(() => setSettingsLoaded(true))
  }, [])

  const saveSettings = () => {
    AsyncStorage.setItem(STORAGE_KEYS.hostIp,          hostIp).catch(() => {})
    AsyncStorage.setItem(STORAGE_KEYS.hostPort,        hostPort).catch(() => {})
    AsyncStorage.setItem(STORAGE_KEYS.sessionPassword, sessionPassword).catch(() => {})
    AsyncStorage.setItem(STORAGE_KEYS.ssl,             ssl ? 'true' : 'false').catch(() => {})
  }
  const [showDropdown,   setShowDropdown]   = useState(false)
  const [selectedClient, setSelectedClient] = useState<ClientInfo | null>(null)
  const [pin,            setPin]            = useState('')
  const pinRef = useRef<TextInput>(null)
  const isConnected = clients.length > 0
  const canConnect = selectedClient !== null && pin.length === 4 && !loading

  // Sequential step highlighting: search → select → pin → ready
  const loginStep = canConnect ? 'ready' : selectedClient !== null ? 'pin' : clients.length > 0 ? 'select' : 'search'

  // Replace comma with period so Danish keyboard works for IP input
  const handleIpChange = (text: string) => setHostIp(text.replace(',', '.'))

  const handleSearch = () => {
    Keyboard.dismiss()
    saveSettings()
    onSearch(hostIp, sessionPassword, ssl, hostPort)
    setShowSettings(false)
  }

  return (
    <SafeAreaView style={s.root}>

      {/* Tap outside to dismiss keyboard */}
      <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
        <View style={s.center}>

          <Text style={s.title}>
            {'EASYC'}
            <Text style={s.titleAccent}>O</Text>
            {'M M'}
            <Text style={s.titleAccent}>O</Text>
            {'BILE'}
          </Text>
          <Text style={s.subtitle}>BROADCAST INTERCOM TERMINAL</Text>

          <View style={s.form}>

            {/* Station dropdown */}
            <Text style={[s.fieldLabel, loginStep === 'select' && s.fieldLabelActive]}>CHOOSE CLIENT</Text>
            <TouchableOpacity
              style={[s.input, isConnected && s.inputActive, loginStep === 'select' && s.inputHighlight]}
              onPress={() => { Keyboard.dismiss(); clients.length > 0 && setShowDropdown(p => !p) }}
              activeOpacity={0.8}
            >
              <Text style={selectedClient ? s.inputTextActive : isConnected ? s.inputTextReady : s.inputTextPlaceholder}>
                {loading
                  ? 'Searching for server...'
                  : selectedClient
                    ? selectedClient.name
                    : clients.length === 0
                      ? 'Searching for server...'
                      : 'Select a client'}
              </Text>
              {clients.length > 0 && (
                <Text style={s.chevron}>{showDropdown ? '▲' : '▼'}</Text>
              )}
              {loading && <ActivityIndicator color={ACCENT} style={{ marginLeft: 8 }} />}
            </TouchableOpacity>

            {showDropdown && clients.length > 0 && (
              <ScrollView
                style={s.dropdown}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator
                nestedScrollEnabled
              >
                {clients.map(c => (
                  <TouchableOpacity
                    key={c.id}
                    style={[s.dropdownItem, selectedClient?.id === c.id && s.dropdownItemOn]}
                    onPress={() => { setSelectedClient(c); setShowDropdown(false) }}
                  >
                    <View style={[s.dot, selectedClient?.id === c.id && s.dotOn]} />
                    <Text style={[s.dropdownText, selectedClient?.id === c.id && s.dropdownTextOn]}>
                      {c.name}
                    </Text>
                    {selectedClient?.id === c.id && <Text style={s.check}>✓</Text>}
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}

            {/* PIN */}
            <Text style={[s.fieldLabel, { marginTop: 16 }, loginStep === 'pin' && s.fieldLabelActive]}>ACCESS PIN</Text>
            <TextInput
              ref={pinRef}
              style={[s.input, s.pinInput, loginStep === 'pin' && s.inputHighlight]}
              value={pin}
              onChangeText={t => { const v = t.replace(/\D/g, '').slice(0, 4); setPin(v); if (v.length === 4) pinRef.current?.blur() }}
              placeholder="·   ·   ·   ·"
              placeholderTextColor="#333"
              keyboardType="number-pad"
              secureTextEntry
              maxLength={4}
              textAlign="center"

            />

            <View style={{ marginTop: 8, marginBottom: 2 }}>
              <Text style={{ color: '#555', fontSize: 10, fontFamily: 'Courier', textAlign: 'center' }}>
                {ssl ? 'https' : 'http'}://{hostIp}:{hostPort || '3000'}
              </Text>
            </View>

            {!!error && (
              <View style={s.errorBox}>
                <Text style={s.errorText}>⚠ {error}</Text>
              </View>
            )}

            {/* Initialize Link + Search row */}
            <View style={s.initRow}>
              <TouchableOpacity
                style={[s.connectBtn, !canConnect && s.connectBtnOff, { flex: 1 }]}
                onPress={() => { Keyboard.dismiss(); canConnect && onConnect(selectedClient!, pin) }}
                disabled={!canConnect}
              >
                {loading
                  ? <ActivityIndicator color="#fff" />
                  : <Text style={s.connectBtnText}>INITIALIZE LINK</Text>
                }
              </TouchableOpacity>
              <TouchableOpacity style={[s.sogBtn, loginStep === 'search' && s.sogBtnActive]} onPress={() => { Keyboard.dismiss(); onSearch(hostIp, sessionPassword, ssl, hostPort) }} disabled={loading}>
                <Text style={[s.searchBtnIcon, loginStep === 'search' && s.searchBtnIconActive]}>↻</Text>
                <Text style={[s.sogBtnText, loginStep === 'search' && s.sogBtnTextActive]}>SEARCH</Text>
              </TouchableOpacity>
            </View>

            {/* Bottom row - settings only */}
            <TouchableOpacity style={s.settingsBtn} onPress={() => { Keyboard.dismiss(); setShowSettings(true) }}>
              <Text style={s.settingsBtnIcon}>⚙</Text>
              <Text style={s.settingsBtnText}>CONNECTION SETTINGS</Text>
            </TouchableOpacity>

          </View>

          <View style={s.footerRow}>
            <Text style={s.footer}>© 2025 EASYCOM SYSTEMS · V1.0</Text>
            <Text style={s.footerSep}>·</Text>
            <TouchableOpacity onPress={() => setShowPrivacy(true)}>
              <Text style={s.footerLink}>PRIVACY POLICY</Text>
            </TouchableOpacity>
          </View>
        </View>
      </TouchableWithoutFeedback>

      {/* ─── CONNECTION SETTINGS MODAL ─── */}
      <Modal visible={showSettings} animationType="slide" transparent presentationStyle="overFullScreen">
        <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
          <KeyboardAvoidingView style={s.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <View style={s.modalSheet}>

              <View style={s.modalHeader}>
                <View>
                  <Text style={s.modalTitle}>CONNECTION SETTINGS</Text>
                  <Text style={s.modalSubtitle}>NETWORK CONFIGURATION</Text>
                </View>
                <TouchableOpacity style={s.closeBtn} onPress={() => { Keyboard.dismiss(); setShowSettings(false) }}>
                  <Text style={s.closeBtnText}>✕</Text>
                </TouchableOpacity>
              </View>

              <ScrollView
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
                keyboardDismissMode="on-drag"
              >

                <Text style={s.fieldLabel}>SERVER IP / HOSTNAME</Text>
                <TextInput
                  style={s.modalInput}
                  value={hostIp}
                  onChangeText={handleIpChange}
                  placeholder="192.168.1.x"
                  placeholderTextColor="#444"
                  keyboardType="numbers-and-punctuation"
                  autoCorrect={false}
                  autoCapitalize="none"
                  returnKeyType="done"
                  onSubmitEditing={Keyboard.dismiss}
                />
                <Text style={s.hint}>Local IP or external domain – works globally</Text>

                <Text style={[s.fieldLabel, { marginTop: 20 }]}>PORT</Text>
                <TextInput
                  style={s.modalInput}
                  value={hostPort}
                  onChangeText={setHostPort}
                  placeholder="3000"
                  placeholderTextColor="#444"
                  keyboardType="number-pad"
                  returnKeyType="done"
                  onSubmitEditing={Keyboard.dismiss}
                />

                <Text style={[s.fieldLabel, { marginTop: 20 }]}>SESSION PASSWORD</Text>
                <TextInput
                  style={s.modalInput}
                  value={sessionPassword}
                  onChangeText={setSessionPassword}
                  placeholder="Leave empty if none"
                  placeholderTextColor="#444"
                  secureTextEntry
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="done"
                  onSubmitEditing={Keyboard.dismiss}
                />
                <Text style={s.hint}>Required if the host has a session password set</Text>

                <View style={s.sslRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.sslLabel}>Secure connection (SSL)</Text>
                    <Text style={s.hint}>Use https/wss – requires SSL certificate</Text>
                  </View>
                  <Switch
                    value={ssl}
                    onValueChange={setSsl}
                    trackColor={{ false: '#2a2a2a', true: ACCENT }}
                    thumbColor="#fff"
                  />
                </View>

                <TouchableOpacity style={s.openWithoutBtn} onPress={onOpenWithoutConnection}>
                  <Text style={s.openWithoutText}>OPEN WITHOUT CONNECTION</Text>
                </TouchableOpacity>
                <Text style={[s.hint, { textAlign: 'center', marginTop: 6 }]}>
                  Open the app without network – for setup and testing
                </Text>

                <View style={{ height: 24 }} />
              </ScrollView>

              <TouchableOpacity style={s.connectBtn} onPress={() => { Keyboard.dismiss(); saveSettings(); setShowSettings(false) }}>
                <Text style={s.connectBtnText}>SAVE & CLOSE</Text>
              </TouchableOpacity>

            </View>
          </KeyboardAvoidingView>
        </TouchableWithoutFeedback>
      </Modal>

      {/* ─── PRIVACY POLICY MODAL ─── */}
      <Modal visible={showPrivacy} animationType="slide" transparent presentationStyle="overFullScreen">
        <View style={s.modalOverlay}>
          <View style={[s.modalSheet, { paddingBottom: 48 }]}>
            <View style={s.modalHeader}>
              <View>
                <Text style={s.modalTitle}>PRIVACY POLICY</Text>
                <Text style={s.modalSubtitle}>LAST UPDATED: JULY 2025</Text>
              </View>
              <TouchableOpacity style={s.closeBtn} onPress={() => setShowPrivacy(false)}>
                <Text style={s.closeBtnText}>✕</Text>
              </TouchableOpacity>
            </View>
            <ScrollView showsVerticalScrollIndicator={false}>
              {[
                ['1. Overview',
                  'EasyCom ("the App") is a professional broadcast intercom terminal designed for use with self-hosted EasyCom servers. This policy explains how the App handles your information.'],
                ['2. Data We Collect',
                  'The App stores the following data locally on your device only:\n\n• Server IP address / hostname\n• Server port number\n• Session password (encrypted on device)\n• SSL preference\n\nThis data is never transmitted to EasyCom or any third party. It is used solely to connect to your own server.'],
                ['3. Microphone Access',
                  'The App requests microphone permission to enable real-time voice communication through the intercom system. Audio is transmitted directly between your device and the server you connect to. EasyCom does not record, store or process your audio.'],
                ['4. Camera Access',
                  'The App requests camera permission to display video feeds from connected broadcast intercom systems. EasyCom does not record, store or process your video.'],
                ['5. Local Network Access',
                  'The App requires local network access to discover and connect to intercom servers on your network. No data is sent to external servers by EasyCom.'],
                ['6. No Third-Party Tracking',
                  'The App contains no advertising SDKs, analytics services, or tracking frameworks. We do not collect usage statistics, crash reports, or any personally identifiable information.'],
                ['7. Data Retention',
                  'All settings stored by the App remain on your device and can be cleared at any time by deleting the App.'],
                ['8. Children',
                  'The App is intended for professional broadcast and production use and is not directed at children under 13.'],
                ['9. Contact',
                  'If you have questions about this privacy policy, contact us at: support@easycom.dk'],
              ].map(([title, body]) => (
                <View key={title as string} style={{ marginBottom: 20 }}>
                  <Text style={s.privacyHeading}>{title as string}</Text>
                  <Text style={s.privacyBody}>{body as string}</Text>
                </View>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>

    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  root:                 { flex: 1, backgroundColor: BG },
  center:               { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 },

  title:                { color: '#fff', fontSize: 26, fontWeight: '900', fontStyle: 'italic', letterSpacing: 2, textAlign: 'center', marginBottom: 0 },
  titleAccent:          { color: '#f97316' },
  subtitle:             { color: '#3a3a3a', fontSize: 8, letterSpacing: 5, marginTop: 5, marginBottom: 36, textAlign: 'center' },

  form:                 { width: '100%', gap: 6 },
  fieldLabel:           { color: '#444', fontSize: 8, fontWeight: '900', letterSpacing: 3, textTransform: 'uppercase', marginBottom: 6 },

  input:                { backgroundColor: CARD, borderRadius: 12, borderWidth: 1, borderColor: BORDER, paddingHorizontal: 16, paddingVertical: 16, flexDirection: 'row', alignItems: 'center' },
  inputActive:          { backgroundColor: '#1a1a1a', borderColor: '#3a3a3a' },
  inputTextPlaceholder: { flex: 1, color: '#3a3a3a', fontSize: 14 },
  inputTextReady:       { flex: 1, color: '#888', fontSize: 14 },
  inputTextActive:      { flex: 1, color: '#fff', fontSize: 14, fontWeight: '600' },
  chevron:              { color: '#444', fontSize: 10 },
  pinInput:             { color: '#fff', fontSize: 22, letterSpacing: 14, textAlign: 'center' },

  dropdown:             { backgroundColor: CARD, borderRadius: 12, borderWidth: 1, borderColor: BORDER, marginTop: -4, maxHeight: 260 },
  dropdownItem:         { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderBottomWidth: 1, borderBottomColor: BORDER },
  dropdownItemOn:       { backgroundColor: '#1a0e00' },
  dropdownText:         { flex: 1, color: '#666', fontSize: 14, fontWeight: '600' },
  dropdownTextOn:       { color: '#fff' },
  dot:                  { width: 8, height: 8, borderRadius: 4, backgroundColor: '#2a2a2a' },
  dotOn:                { backgroundColor: ACCENT },
  check:                { color: ACCENT, fontSize: 16, fontWeight: '900' },

  connectBtn:           { backgroundColor: ACCENT, borderRadius: 12, padding: 18, alignItems: 'center', justifyContent: 'center' },
  connectBtnOff:        { backgroundColor: '#222' },
  connectBtnText:       { color: '#fff', fontWeight: '900', fontSize: 10, letterSpacing: 2 },

  bottomRow:            { flexDirection: 'row', gap: 10, marginTop: 4 },
  initRow:              { flexDirection: 'row', gap: 10, alignItems: 'stretch', marginTop: 8 },
  settingsBtn:          { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: CARD, borderRadius: 12, borderWidth: 1, borderColor: BORDER, padding: 14, width: '100%' },
  settingsBtnIcon:      { color: '#555', fontSize: 12 },
  settingsBtnText:      { color: '#555', fontSize: 9, fontWeight: '800', letterSpacing: 1 },
  sogBtn:               { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: CARD, borderRadius: 12, borderWidth: 1, borderColor: BORDER, paddingHorizontal: 18, alignSelf: 'stretch' },
  sogBtnActive:         { backgroundColor: ACCENT, borderColor: ACCENT },
  sogBtnText:           { color: ACCENT, fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  sogBtnTextActive:     { color: '#fff' },
  searchBtnIcon:        { color: ACCENT, fontSize: 14 },
  searchBtnIconActive:  { color: '#fff' },
  fieldLabelActive:     { color: ACCENT },
  inputHighlight:       { borderColor: ACCENT, borderWidth: 1.5 },

  errorBox:             { backgroundColor: '#1a0000', borderWidth: 1, borderColor: '#ef444440', borderRadius: 10, padding: 12 },
  errorText:            { color: '#ef4444', fontSize: 12, textAlign: 'center' },

  footerRow:            { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 36 },
  footer:               { color: '#222', fontSize: 8, letterSpacing: 2, textAlign: 'center' },
  footerSep:            { color: '#222', fontSize: 8 },
  footerLink:           { color: '#444', fontSize: 8, letterSpacing: 2, textDecorationLine: 'underline' },
  privacyHeading:       { color: '#f97316', fontSize: 10, fontWeight: '900', letterSpacing: 2, marginBottom: 6, textTransform: 'uppercase' },
  privacyBody:          { color: '#888', fontSize: 13, lineHeight: 20 },

  modalOverlay:         { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.75)' },
  modalSheet:           { backgroundColor: '#111', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 36, maxHeight: '92%' },
  modalHeader:          { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24 },
  modalTitle:           { color: '#fff', fontSize: 18, fontWeight: '900', fontStyle: 'italic', letterSpacing: 1 },
  modalSubtitle:        { color: '#444', fontSize: 8, letterSpacing: 3, marginTop: 4 },
  closeBtn:             { width: 32, height: 32, borderRadius: 16, backgroundColor: '#222', alignItems: 'center', justifyContent: 'center' },
  closeBtnText:         { color: '#fff', fontSize: 12, fontWeight: '700' },
  modalInput:           { backgroundColor: '#0d0d0d', borderRadius: 12, borderWidth: 1, borderColor: BORDER, paddingHorizontal: 16, paddingVertical: 16, color: '#fff', fontSize: 16 },
  hint:                 { color: '#333', fontSize: 10, marginTop: 5, letterSpacing: 0.3 },
  sslRow:               { flexDirection: 'row', alignItems: 'center', marginTop: 20, gap: 12 },
  sslLabel:             { color: '#ccc', fontSize: 14, fontWeight: '600' },
  modalSogBtn:          { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#1f0d00', borderRadius: 12, borderWidth: 1, borderColor: ACCENT + '55', padding: 16, marginTop: 24 },
  divider:              { height: 1, backgroundColor: BORDER, marginVertical: 20 },
  openWithoutBtn:       { backgroundColor: '#1c1c1c', borderRadius: 12, borderWidth: 1, borderColor: BORDER, padding: 16, alignItems: 'center' },
  openWithoutText:      { color: '#666', fontWeight: '800', fontSize: 12, letterSpacing: 1 },
})
