/**
 * clientHandshake.ts – deles af host-app OG mobile-app
 * Placér i: client/webrtc/clientHandshake.ts (host) / src/webrtc/clientHandshake.ts (mobil)
 */

import { socket } from "./intercom"
import { initMediasoup, setClientId, getDevice, getSendTransport, produceStream } from "./mediasoupClient"
import { initRouting } from "./intercom"

let socketInstance = socket

export function setSocket(s: any) { socketInstance = s }

/* ── REGISTER ── */

export function registerClient(client: {
  id: string
  name: string
  type: "mobile" | "desktop" | "aux"
}, cb?: () => void) {
  socketInstance.emit("client:register", client, (res: any) => {
    if (res?.ok) {
      console.log(`[handshake] ✅ registered as "${client.id}"`)
      cb?.()
    } else {
      console.error(`[handshake] ❌ register failed for "${client.id}"`)
    }
  })
}

/* ── INIT AUDIO (the key function) ──
 * Kalder initMediasoup() + initRouting() i rækkefølge.
 * Skal kaldes EFTER socket er connected og client er registered.
 */
export async function initAudio(clientId: string): Promise<void> {
  console.log(`[initAudio] starting for "${clientId}"`)
  setClientId(clientId)
  try {
    await initMediasoup()
    initRouting(clientId)
    console.log(`[initAudio] ✅ ready for "${clientId}"`)
  } catch (e) {
    console.error(`[initAudio] ❌ failed for "${clientId}":`, e)
    throw e
  }
}

/* ── MIC (for clients that send audio) ── */

export async function attachMicrophone() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    socketInstance.emit("client:mic-attached", { ok: true })
    return stream
  } catch (e) {
    console.warn("[handshake] mic access denied:", e)
    return null
  }
}

export async function startAudio(clientId: string) {
  const device = getDevice()
  const transport = getSendTransport()
  if (!device || !transport) return null
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  return await produceStream(stream)
}
