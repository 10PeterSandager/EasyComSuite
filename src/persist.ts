// persist.ts – Server-side state persistence
// Saves all routing/config state to data.json so the server restores
// exactly where it left off after a restart or power failure.

import fs from "fs"
import path from "path"

const DATA_FILE = path.resolve(process.cwd(), "data.json")

export interface PersistedState {
  connections:          Array<{ from: string; to: string; channel: number; toChannel?: number }>
  groups:               Array<{ id: string; name: string; members: string[]; channel: number; color?: string }>
  clients:              Array<{ id: string; data: any }>
  audioRoutes:          Array<{ deviceId: string; deviceLabel: string; kind: string; channel: number; clientId: string }>
  bridgeChannelInfo:    any[]
  outputBridgeChannels: number[]
  streamDeckLayout:     any[]
  terminals:            Array<{ id: string; name: string; code: string; pairedClientId?: string }>
  videoRouting:         Array<{ clientId: string; sources: number[] }>
}

const EMPTY: PersistedState = {
  connections: [], groups: [], clients: [],
  audioRoutes: [], bridgeChannelInfo: [], outputBridgeChannels: [], streamDeckLayout: [],
  terminals: [], videoRouting: [],
}

export function loadState(): PersistedState {
  try {
    const raw = fs.readFileSync(DATA_FILE, "utf8")
    return { ...EMPTY, ...JSON.parse(raw) }
  } catch {
    return { ...EMPTY }
  }
}

// Debounced save — writes at most once per second regardless of how often called
let _saveTimer: ReturnType<typeof setTimeout> | null = null
export function scheduleSave(getState: () => PersistedState) {
  if (_saveTimer) clearTimeout(_saveTimer)
  _saveTimer = setTimeout(() => {
    _saveTimer = null
    try {
      fs.writeFileSync(DATA_FILE, JSON.stringify(getState(), null, 2), "utf8")
    } catch (e) {
      console.warn("[persist] Could not write data.json:", e)
    }
  }, 1000)
}
