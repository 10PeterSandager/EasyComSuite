import * as mediasoup from "mediasoup"
import * as os from "os"

function getLocalIp(): string {
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const iface of ifaces ?? []) {
      if (iface.family === "IPv4" && !iface.internal && !iface.address.startsWith("169.254."))
        return iface.address
    }
  }
  return "127.0.0.1"
}

let worker: mediasoup.types.Worker
export let router: mediasoup.types.Router

// Announced IP can be updated at runtime from the HOST UI without restarting.
let _runtimeAnnouncedIp: string | null = null
export function setAnnouncedIp(ip: string) { _runtimeAnnouncedIp = ip || null }

const transports = new Map<string, mediasoup.types.WebRtcTransport>()
const producers = new Map<string, mediasoup.types.Producer>()
const consumers = new Map<string, mediasoup.types.Consumer>()

/* ---------- INIT ---------- */

export async function initMediasoup() {

  worker = await mediasoup.createWorker({
    logLevel: "warn",
    rtcMinPort: 40000,
    rtcMaxPort: 49999
  })

  worker.on("died", () => {
    console.error("mediasoup worker died – restarting process")
    process.exit(1)
  })

  router = await worker.createRouter({
    mediaCodecs: [
      {
        kind: "audio",
        mimeType: "audio/opus",
        clockRate: 48000,
        channels: 2
      },
      {
        kind: "video",
        mimeType: "video/VP8",
        clockRate: 90000,
        parameters: { "x-google-start-bitrate": 1000 }
      },
      {
        kind: "video",
        mimeType: "video/H264",
        clockRate: 90000,
        parameters: {
          "packetization-mode": 1,
          "profile-level-id": "42e01f",
          "level-asymmetry-allowed": 1
        }
      }
    ]
  })

  console.log("✅ Mediasoup router created")
}

/* ---------- CREATE TRANSPORT ---------- */

export async function createTransport(direction: "send" | "recv") {

  const localIp = getLocalIp()
  // Announce local LAN IP so phones on the same network get a reachable ICE candidate.
  // The external IP (MEDIASOUP_ANNOUNCED_IP) only matters for internet clients, which
  // currently use Cloudflare tunnel (no UDP relay) so WebRTC to external IPs doesn't
  // work anyway. Local-only is correct for all current use cases.
  const announcedIp = localIp

  const transport = await router.createWebRtcTransport({
    listenIps: [{ ip: "0.0.0.0", announcedIp }],
    enableUdp: true,
    enableTcp: true,
    preferUdp: true,
    initialAvailableOutgoingBitrate: 1_000_000
  })

  transports.set(transport.id, transport)

  transport.on("dtlsstatechange", (state) => {
    if (state === "closed") {
      transports.delete(transport.id)
    }
  })

  return transport
}

/* ---------- CONNECT TRANSPORT ---------- */

export async function connectTransport(transportId: string, dtlsParameters: any) {

  const transport = transports.get(transportId)
  if (!transport) {
    console.error("connectTransport: transport not found", transportId)
    return
  }

  await transport.connect({ dtlsParameters })
}

/* ---------- PRODUCE ---------- */

import { types } from "mediasoup"

export async function produce(
  transportId: string,
  kind: types.MediaKind,
  rtpParameters: any
) {

  const transport = transports.get(transportId)
  if (!transport) throw new Error(`produce: transport not found ${transportId}`)

  const producer = await transport.produce({ kind, rtpParameters })

  producers.set(producer.id, producer)

  producer.on("transportclose", () => {
    producers.delete(producer.id)
  })

  console.log(`✅ Producer created: ${producer.id} (${kind})`)

  return producer
}

/* ---------- 🔥 CONSUME – WAS MISSING ---------- */

export async function consume(
  transportId: string,
  producerId: string,
  rtpCapabilities: types.RtpCapabilities
) {

  const transport = transports.get(transportId)
  if (!transport) throw new Error(`consume: transport not found ${transportId}`)

  // Check router can consume this producer
  if (!router.canConsume({ producerId, rtpCapabilities })) {
    throw new Error(`consume: router cannot consume producer ${producerId}`)
  }

  const consumer = await transport.consume({
    producerId,
    rtpCapabilities,
    paused: false  // Start unpaused so audio flows immediately
  })

  consumers.set(consumer.id, consumer)

  consumer.on("transportclose", () => {
    consumers.delete(consumer.id)
  })

  consumer.on("producerclose", () => {
    consumers.delete(consumer.id)
  })

  console.log(`✅ Consumer created: ${consumer.id} → producer ${producerId}`)

  return consumer
}

/* ---------- GETTERS ---------- */

export function getProducer(producerId: string) {
  return producers.get(producerId)
}

export function getConsumer(consumerId: string) {
  return consumers.get(consumerId)
}

export function getAllConsumers() {
  return Array.from(consumers.entries()).map(([id, c]) => ({
    id,
    producerId: c.producerId,
    kind: c.kind,
    paused: c.paused,
    closed: c.closed
  }))
}

export function getTransport(transportId: string) {
  return transports.get(transportId)
}
