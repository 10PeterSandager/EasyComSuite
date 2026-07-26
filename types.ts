/* ------------------------------------------------ */
/* VIEW MODES                                       */
/* ------------------------------------------------ */

export enum ViewMode {
  HOST = "HOST",
  MOBILE = "MOBILE",
  DESKTOP = "DESKTOP",
  REMOTE_PANELS = "REMOTE_PANELS"
}

/* ------------------------------------------------ */
/* NETWORK MESSAGE                                  */
/* ------------------------------------------------ */

export interface NetworkMessage {
  type:
    | "EVENT_TALK_START"
    | "EVENT_TALK_STOP"
    | "EVENT_STATE_SYNC"
    | "EVENT_REMOTE_RESET"
  payload: any
  senderId: string
}

/* ------------------------------------------------ */
/* WEBRTC STATE                                     */
/* ------------------------------------------------ */

export interface RTCState {
  peerId: string
  status: "connecting" | "connected" | "disconnected"
  hasAudio: boolean
  stream?: MediaStream
}

/* ------------------------------------------------ */
/* GPIO                                             */
/* ------------------------------------------------ */

export interface GPIOConfig {
  id: number
  label: string
  ip: string
  port: number
  protocol: "UDP" | "TCP"
  isActive: boolean
}

/* ------------------------------------------------ */
/* CHANNEL MIXER                                    */
/* ------------------------------------------------ */

export interface ChannelMixerSettings {
  gain: number
  mute: boolean
  duckEnabled?: boolean
  duckAmount?: number
  gateEnabled?: boolean
  gateThreshold: number
  eq: {
    low: number
    mid: number
    high: number
  }
}

/* ------------------------------------------------ */
/* CLIENT                                           */
/* ------------------------------------------------ */

export interface Client {

  id: string
  name: string

  type: "mobile" | "desktop" | "remote" | "aux"
  status: "online" | "offline"

  /* TALK */
  isTalking: boolean
  isLatched: boolean
  remoteIsLatched?: boolean
  isMuted: boolean
  isIFBActive: boolean
  isBacktalkActive: boolean
  isTBVActive?: boolean

  /* AUDIO */
  gain: number
  volume: number
  levels: number[]
  micLevel: number
  auxLevel: number
  inputGains?: number[]

  /* ROUTING */
  tbActive: boolean[]
  muteOnTalk: boolean[]
  openOnTalk: boolean[]

  /* 🔥 RECEIVE CHANNELS – which channels this client listens on */
  receiveChannels?: number[]

  /* 🔥 IFB – duck amount when IFB is active (0-100) */
  ifbDuckAmount?: number
  ifbActive?: boolean

  /* MIXER */
  channelMixer?: Record<number, ChannelMixerSettings>

  /* IDENTIFICATION */
  keyTrigger?: string
  code: string
  order: number
  hidden: boolean
  color: string

  /* IFB */
  ifbNames: string[]
  ifbChannels?: Record<number, string[]>

  /* VIDEO */
  videoSources: number[]

  /* HARDWARE */
  gpioAssignment?: number

  /* PRIORITY SYSTEM */
  role?: "user" | "producer" | "director"
  priority?: number

  /* CUSTOM ROLE (user-defined from Global Settings) */
  customRole?: string

  /* LINKING */
  linkedSourceId?: string

}

/* ------------------------------------------------ */
/* HARDWARE INTERFACE                               */
/* ------------------------------------------------ */

export interface HardwareInterface {
  id: string
  name: string
  inputs: number
  outputs: number
  type: "ASIO" | "COREAUDIO" | "DANTE" | "WDM"
  isOnline: boolean
}

/* ------------------------------------------------ */
/* NETWORK CONFIG                                   */
/* ------------------------------------------------ */

export interface NetworkConfig {
  ip: string
  subnet: string
  gateway: string
  port: number
  danteMaster: boolean
  encryptionKey: string
  interfaceType: "DANTE" | "REGULAR"
  activeSoundcard: string
  deviceId?: string
  inputCount: number
  outputCount: number
}

/* ------------------------------------------------ */
/* TERMINAL (QR Remote Panel)                       */
/* ------------------------------------------------ */

export interface Terminal {
  id: string
  name: string
  code: string
  pairedClientId?: string
  connected?: boolean
}

/* ------------------------------------------------ */
/* REMOTE PANEL                                     */
/* ------------------------------------------------ */

export interface RemotePanelNode {
  id: string
  name: string
  ip: string
  type: string
  panelType: "pad" | "streamdeck"
  status: "connected" | "offline"
  gridColumns: number
  slotCount: number
  linkedClientId?: string
  audioInputChannel?: number
}

/* ------------------------------------------------ */
/* REMOTE HOST                                      */
/* ------------------------------------------------ */

export interface RemoteHost {
  id: string
  name: string
  ip: string
  status: "online" | "locked"
  clientsCount: number
}

/* ------------------------------------------------ */
/* PRESET                                           */
/* ------------------------------------------------ */

export interface Preset {
  id: string
  name: string
  config: NetworkConfig
  clients: Client[]
}

/* ------------------------------------------------ */
/* MOBILE PRESET                                    */
/* ------------------------------------------------ */

export interface MobilePreset {
  id: string
  name: string
  talkNames: { talk1: string; talk2: string }
  channelModes: ("mono" | "stereo")[]
  gains: number[]
  pans: number[]
  latches: { latch1: boolean; latch2: boolean }
}

/* ------------------------------------------------ */
/* SIGNAL GROUP                                     */
/* ------------------------------------------------ */

export interface SignalGroup {
  id: string
  name: string
  members: string[]
  color?: string
}

/* ------------------------------------------------ */
/* GROUP (TALK GROUP)                               */
/* ------------------------------------------------ */

export interface TalkGroup {
  id: string
  name: string
  members: string[]   // client IDs
  channel: number
  color?: string
}

/* ------------------------------------------------ */
/* MAPPED CLIENT                                    */
/* ------------------------------------------------ */

export type MappedClient = Client & {
  socketId: string
  isGroupLatch?: boolean
  memberIds?: string[]
  isLatchCopy?: boolean
}
