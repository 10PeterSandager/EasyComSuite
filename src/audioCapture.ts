/**
 * audioCapture.ts – multi-kanal med auto-detect og config-bridge
 *
 * Kanal-navne og typer bestemmes i prioriteret rækkefølge:
 *  1. audioDeviceConfig.json (admin-override, valgfri)
 *  2. Auto-detect baseret på enhedsnavn + antal kanaler
 *  3. Fallback: CH1, CH2 ... (alle input)
 *
 * Platform-support:
 *  - macOS  : Swift binary (audio_capture_bin) via CoreAudio
 *  - Windows: naudiodon (PortAudio/WASAPI) – ingen ekstern binary nødvendig
 */

import { Server } from "socket.io"
import { spawn } from "child_process"
import { execSync } from "child_process"
import * as fs from "fs"
import * as path from "path"
import { EventEmitter } from "events"
import { registerOutputDevice } from "./audioOutput"

/* ---- PLATFORM ---- */

const IS_MAC = process.platform === "darwin"
// __dirname is dist/ at runtime — binary lives in src/ next to it
const CAPTURE_BIN = path.join(__dirname, "..", "src", "audio_capture_bin")

let naudiodon: any = null
if (!IS_MAC) {
  try {
    naudiodon = require("naudiodon")
    console.log("✅ naudiodon loaded for Windows/Linux audio capture")
  } catch (e: any) {
    console.error("❌ naudiodon failed to load:", e.message)
  }
}

/* ---- TYPES ---- */

type ChannelType = "input" | "output"
type ChannelInfo = { channel: number; name: string; type: ChannelType; autoDetected: boolean }
type DeviceConfig = { channels: Record<string, { name: string; type: ChannelType }> }
type AudioConfig = Record<string, DeviceConfig>

type CaptureProcess = {
  stdout: EventEmitter
  stderr: EventEmitter
  kill: (signal?: string) => void
  on: (event: string, handler: (...args: any[]) => void) => void
}

type CaptureSession = {
  process: CaptureProcess
  deviceIndex: number
  totalChannels: number
  sampleRate: number
}

const sessions = new Map<string, CaptureSession>()

/* ---- CONFIG FILE ---- */

function loadConfig(): AudioConfig {
  try {
    const p = path.join(__dirname, "audioDeviceConfig.json")
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, "utf-8"))
  } catch {}
  return {}
}

/* ---- AUTO-DETECT ---- */

const KNOWN_DEVICES: Array<{
  match: RegExp
  getChannels: (total: number) => ChannelInfo[]
}> = [
  {
    // Universal Audio Apollo (Thunderbolt/USB)
    match: /universal audio|apollo/i,
    getChannels: (total) => {
      const ch: ChannelInfo[] = []
      for (let i = 1; i <= total; i++) {
        let name = `CH${i}`
        let type: ChannelType = "input"
        if (i <= 2) { name = `Mic ${i}`; type = "input" }
        else if (i <= 8) { name = `Line ${i}`; type = "input" }
        else if (i <= 16) { name = `ADAT ${i - 8}`; type = "input" }
        else if (i === 17) { name = "Loopback L"; type = "input" }
        else if (i === 18) { name = "Loopback R"; type = "input" }
        else if (i <= 26) { name = `Line Out ${i - 18}`; type = "output" }
        else if (i === 27) { name = "Loopback 2 L"; type = "input" }
        else if (i === 28) { name = "Loopback 2 R"; type = "input" }
        else if (i === 29) { name = "Loopback 3 L"; type = "input" }
        else if (i === 30) { name = "Loopback 3 R"; type = "input" }
        ch.push({ channel: i, name, type, autoDetected: true })
      }
      return ch
    }
  },
  {
    // Focusrite Scarlett / Clarett
    match: /focusrite|scarlett|clarett/i,
    getChannels: (total) => {
      const ch: ChannelInfo[] = []
      const outputStart = Math.ceil(total / 2) + 1
      for (let i = 1; i <= total; i++) {
        const isOut = i >= outputStart
        let name = isOut ? `Out ${i - outputStart + 1}` : `In ${i}`
        if (i === 1 && !isOut) name = "Mic/Line L"
        if (i === 2 && !isOut) name = "Mic/Line R"
        ch.push({ channel: i, name, type: isOut ? "output" : "input", autoDetected: true })
      }
      return ch
    }
  },
  {
    // RME interfaces
    match: /rme|fireface|babyface/i,
    getChannels: (total) => {
      const ch: ChannelInfo[] = []
      const half = Math.ceil(total / 2)
      for (let i = 1; i <= total; i++) {
        const isOut = i > half
        ch.push({
          channel: i,
          name: isOut ? `Out ${i - half}` : `In ${i}`,
          type: isOut ? "output" : "input",
          autoDetected: true
        })
      }
      return ch
    }
  },
  {
    // MOTU interfaces
    match: /motu/i,
    getChannels: (total) => {
      const ch: ChannelInfo[] = []
      const half = Math.ceil(total / 2)
      for (let i = 1; i <= total; i++) {
        const isOut = i > half
        ch.push({
          channel: i,
          name: isOut ? `MOTU Out ${i - half}` : `MOTU In ${i}`,
          type: isOut ? "output" : "input",
          autoDetected: true
        })
      }
      return ch
    }
  },
  {
    match: /macbook|imac|mac mini|mac pro|built-in/i,
    getChannels: (total) => {
      const ch: ChannelInfo[] = []
      for (let i = 1; i <= total; i++) {
        ch.push({ channel: i, name: `Built-in Mic ${i}`, type: "input", autoDetected: true })
      }
      return ch
    }
  }
]

function autoDetectChannels(deviceName: string, total: number): ChannelInfo[] {
  for (const known of KNOWN_DEVICES) {
    if (known.match.test(deviceName)) return known.getChannels(total)
  }
  const ch: ChannelInfo[] = []
  const outputStart = total > 2 ? Math.ceil(total * 0.6) + 1 : total + 1
  for (let i = 1; i <= total; i++) {
    const isOut = i >= outputStart
    ch.push({
      channel: i,
      name: isOut ? `Output ${i - outputStart + 1}` : `Input ${i}`,
      type: isOut ? "output" : "input",
      autoDetected: true
    })
  }
  return ch
}

function buildChannelInfo(deviceName: string, total: number): ChannelInfo[] {
  const config = loadConfig()
  const deviceConfig = config[deviceName]
  const auto = autoDetectChannels(deviceName, total)
  if (deviceConfig?.channels) {
    return auto.map(ch => {
      const override = deviceConfig.channels[String(ch.channel)]
      if (override) return { ...ch, ...override, autoDetected: false }
      return ch
    })
  }
  return auto
}

/* ---- FFMPEG CHECK (Mac only) ---- */

function checkFfmpeg(): boolean {
  const candidates = [
    "/opt/homebrew/bin/ffmpeg",
    "/usr/local/bin/ffmpeg",
    "/usr/bin/ffmpeg",
  ]
  for (const p of candidates) {
    try { execSync(`"${p}" -version`, { stdio: "ignore" }); return true } catch {}
  }
  try { execSync("which ffmpeg", { stdio: "ignore" }); return true } catch { return false }
}

/* ---- DEVICE LISTING ---- */

function listAudioDevices(): Promise<Array<{ index: number; name: string; channels: number }>> {
  return IS_MAC ? listAudioDevicesMac() : listAudioDevicesNaudiodon()
}

function listAudioDevicesMac(): Promise<Array<{ index: number; name: string; channels: number }>> {
  return new Promise((resolve) => {
    const proc = spawn(CAPTURE_BIN, ["0", "48000", "2"], { stdio: ["ignore", "pipe", "pipe"] })
    let output = ""
    proc.stderr.on("data", (d: Buffer) => { output += d.toString() })
    setTimeout(() => { try { proc.kill() } catch {} }, 2000)
    proc.on("close", () => {
      const devices: Array<{ index: number; name: string; channels: number }> = []
      const lines = output.split("\n")
      let inList = false
      for (const line of lines) {
        if (line.trim() === "DEVICES_START") { inList = true; continue }
        if (line.trim() === "DEVICES_END")   { inList = false; continue }
        if (inList) {
          const m = line.match(/^DEVICE:(\d+):(.+):(\d+)$/)
          if (m) {
            const ch = parseInt(m[3])
            if (ch > 0)
              devices.push({ index: parseInt(m[1]), name: m[2].trim(), channels: ch })
          }
        }
      }
      console.log("🎛️  Lydenheder:", devices.map(d => `[${d.index}] ${d.name} (${d.channels}ch)`).join(", "))
      resolve(devices)
    })
  })
}

function listAudioDevicesNaudiodon(): Promise<Array<{ index: number; name: string; channels: number }>> {
  return new Promise((resolve) => {
    if (!naudiodon) { resolve([]); return }
    try {
      const all: Array<{
        id: number; name: string
        maxInputChannels: number; maxOutputChannels: number
      }> = naudiodon.getDevices()

      const devices = all
        .filter(d => d.maxInputChannels > 0)
        .map(d => ({ index: d.id, name: d.name, channels: d.maxInputChannels }))

      console.log("🎛️  Lydenheder (naudiodon):", devices.map(d => `[${d.index}] ${d.name} (${d.channels}ch)`).join(", "))
      resolve(devices)
    } catch (e: any) {
      console.error("naudiodon getDevices failed:", e.message)
      resolve([])
    }
  })
}

/* ---- CAPTURE FACTORIES ---- */

function spawnMacCapture(deviceIndex: number, sampleRate: number): CaptureProcess {
  const proc = spawn(CAPTURE_BIN, [
    String(deviceIndex), String(sampleRate), "30"
  ], { stdio: ["ignore", "pipe", "pipe"] })

  return {
    stdout: proc.stdout!,
    stderr: proc.stderr!,
    kill: (sig) => { try { proc.kill(sig as any ?? "SIGTERM") } catch {} },
    on: (event, handler) => { proc.on(event as any, handler) }
  }
}

function spawnNaudiodonCapture(deviceIndex: number, sampleRate: number, channelCount: number): CaptureProcess {
  const stderr = new EventEmitter()
  const emitter = new EventEmitter()

  const ai = new naudiodon.AudioIO({
    inOptions: {
      channelCount,
      sampleFormat: naudiodon.SampleFormat16Bit,
      sampleRate,
      deviceId: deviceIndex,
      closeOnError: false,
      framesPerBuffer: 480
    }
  })

  // Emit synthetic protocol signals that match what the Mac binary sends to stderr,
  // so the shared capture handler below needs no platform branching at all.
  setImmediate(() => {
    stderr.emit("data", Buffer.from(`CAPTURE_START:naudiodon:${channelCount}\n`))
    setTimeout(() => stderr.emit("data", Buffer.from("CAPTURE_READY\n")), 150)
  })

  ai.on("error", (err: Error) => emitter.emit("error", err))
  ai.on("close", () => emitter.emit("close", 0))
  ai.start()

  return {
    stdout: ai,
    stderr,
    kill: () => { try { ai.quit() } catch {} },
    on: (event, handler) => emitter.on(event, handler)
  }
}

/* ---- SETUP ---- */

export function setupAudioCapture(io: Server) {

  if (IS_MAC && !checkFfmpeg()) {
    console.warn("⚠️  ffmpeg ikke fundet – kør: brew install ffmpeg")
    io.on("connection", (socket) => {
      socket.on("audio:devices:list", (cb) => cb({ ok: false, error: "ffmpeg ikke installeret" }))
    })
    return
  }

  if (!IS_MAC && !naudiodon) {
    console.warn("⚠️  naudiodon ikke tilgængelig – lydoptagelse deaktiveret")
    io.on("connection", (socket) => {
      socket.on("audio:devices:list", (cb) => cb({ ok: false, error: "naudiodon ikke installeret" }))
    })
    return
  }

  console.log(`✅ Audio capture klar (${IS_MAC ? "macOS CoreAudio" : "Windows PortAudio/WASAPI"})`)

  io.on("connection", (socket) => {

    /* LIST DEVICES */
    socket.on("audio:devices:list", async (cb) => {
      try {
        const rawDevices = await listAudioDevices()
        if (!rawDevices.length) { cb({ ok: false, error: "Ingen lydenheder fundet" }); return }

        const devices = await Promise.all(rawDevices.map(async (d) => {
          // Mac: channel count discovered at capture time (Apollo always 30)
          // Windows: already known from naudiodon.getDevices()
          const totalChannels = IS_MAC ? 30 : d.channels
          const channelInfo = buildChannelInfo(d.name, totalChannels)
          return {
            index: d.index,
            name: d.name,
            channels: totalChannels,
            channelInfo,
            sampleRate: 48000,
            isApollo: /universal audio|apollo/i.test(d.name)
          }
        }))

        cb({ ok: true, devices })
      } catch (e: any) { cb({ ok: false, error: e.message }) }
    })

    /* START CAPTURE */
    socket.on("audio:capture:start", async ({ deviceIndex, deviceName = "", sampleRate = 48000 }, cb) => {
      stopSession(socket.id)
      console.log(`🎙️  Starter capture: device ${deviceIndex} (${deviceName}) @ ${sampleRate}Hz`)

      try {
        // Windows: look up channel count from naudiodon before starting AudioIO
        let naudiodonChannels = 2
        if (!IS_MAC && naudiodon) {
          try {
            const all: Array<{ id: number; maxInputChannels: number }> = naudiodon.getDevices()
            const dev = all.find(d => d.id === deviceIndex)
            naudiodonChannels = dev?.maxInputChannels ?? 2
          } catch {}
        }

        const proc = IS_MAC
          ? spawnMacCapture(deviceIndex, sampleRate)
          : spawnNaudiodonCapture(deviceIndex, sampleRate, naudiodonChannels)

        // Mac: totalChannels updated when CAPTURE_START arrives on stderr
        // Windows: already known, but we still parse the synthetic CAPTURE_START for consistency
        let totalChannels = IS_MAC ? 2 : naudiodonChannels
        let headerParsed = false
        let callbackSent = false
        let buffer = Buffer.alloc(0)

        proc.stderr.on("data", (data: Buffer) => {
          const text = data.toString()
          const match = text.match(/CAPTURE_START:[^:]+:(\d+)/)
          if (match && !headerParsed) {
            totalChannels = parseInt(match[1])
            headerParsed = true
          }
          if (text.includes("CAPTURE_READY") && !callbackSent) {
            callbackSent = true
            const channelInfo = buildChannelInfo(deviceName, totalChannels)
            const outputCount = channelInfo.filter(c => c.type === "output").length
            console.log(`🎙️  ${totalChannels} kanaler – ${channelInfo.filter(c => c.type === "input").length} inputs, ${outputCount} outputs`)
            if (outputCount > 0) registerOutputDevice(deviceIndex, outputCount)
            cb?.({ ok: true, sampleRate, totalChannels, channelInfo })
          }
        })

        setTimeout(() => {
          if (!callbackSent) {
            callbackSent = true
            const channelInfo = buildChannelInfo(deviceName, totalChannels)
            cb?.({ ok: true, sampleRate, totalChannels, channelInfo })
          }
        }, 2000)

        // 480 samples @ 48kHz = 10ms chunks – prevents buffer underruns
        const CHUNK_SAMPLES = 480
        proc.stdout.on("data", (chunk: Buffer) => {
          buffer = Buffer.concat([buffer, chunk])
          const bytesPerSample = 2
          const frameSize = bytesPerSample * totalChannels
          const minBytes = frameSize * CHUNK_SAMPLES

          while (buffer.length >= minBytes) {
            const frameCount = Math.floor(Math.min(buffer.length, minBytes * 2) / frameSize)

            const channelBuffers: Array<{ channel: number; data: Buffer }> = []
            for (let ch = 0; ch < totalChannels; ch++) {
              const mono = Buffer.allocUnsafe(frameCount * bytesPerSample)
              for (let f = 0; f < frameCount; f++) {
                const srcOff = f * frameSize + ch * bytesPerSample
                mono[f * 2]     = buffer[srcOff]
                mono[f * 2 + 1] = buffer[srcOff + 1]
              }
              channelBuffers.push({ channel: ch + 1, data: mono })
            }
            socket.emit("audio:pcm:multi", channelBuffers)

            buffer = buffer.slice(frameCount * frameSize)
          }
        })

        proc.on("error", (err: Error) => {
          socket.emit("audio:capture:error", { error: err.message })
          stopSession(socket.id)
        })

        proc.on("close", (code: number) => {
          if (code !== 0 && code !== null)
            socket.emit("audio:capture:error", { error: `Capture stoppet (kode ${code})` })
          sessions.delete(socket.id)
        })

        sessions.set(socket.id, { process: proc, deviceIndex, totalChannels, sampleRate })

      } catch (e: any) { cb?.({ ok: false, error: e.message }) }
    })

    /* SAVE CHANNEL CONFIG */
    socket.on("audio:channel:config:save", ({ deviceName, channelInfo }: { deviceName: string; channelInfo: ChannelInfo[] }) => {
      try {
        const configPath = path.join(__dirname, "audioDeviceConfig.json")
        const config: AudioConfig = fs.existsSync(configPath)
          ? JSON.parse(fs.readFileSync(configPath, "utf-8"))
          : {}

        config[deviceName] = {
          channels: channelInfo.reduce((acc, ch) => {
            acc[String(ch.channel)] = { name: ch.name, type: ch.type }
            return acc
          }, {} as Record<string, { name: string; type: ChannelType }>)
        }

        fs.writeFileSync(configPath, JSON.stringify(config, null, 2))
        console.log(`💾 Gemt kanal-config for "${deviceName}"`)
        socket.emit("audio:channel:config:saved", { ok: true })
      } catch (e: any) {
        socket.emit("audio:channel:config:saved", { ok: false, error: e.message })
      }
    })

    socket.on("audio:capture:stop", (cb) => { stopSession(socket.id); cb?.({ ok: true }) })
    socket.on("disconnect", () => { stopSession(socket.id) })
  })
}

function stopSession(key: string) {
  const session = sessions.get(key)
  if (!session) return
  try { session.process.kill("SIGTERM") } catch {}
  sessions.delete(key)
  console.log(`⏹️  Capture stopped: ${key}`)
}
