/**
 * audioCapture.ts – multi-kanal med auto-detect og config-bridge
 *
 * Kanal-navne og typer bestemmes i prioriteret rækkefølge:
 *  1. audioDeviceConfig.json (admin-override, valgfri)
 *  2. Auto-detect baseret på enhedsnavn + antal kanaler
 *  3. Fallback: CH1, CH2 ... (alle input)
 */

import { Server } from "socket.io"
import { spawn, ChildProcess } from "child_process"
import { execSync } from "child_process"
import * as fs from "fs"
import * as path from "path"
import { registerOutputDevice } from "./audioOutput"

/* ---- TYPES ---- */

type ChannelType = "input" | "output"
type ChannelInfo = { channel: number; name: string; type: ChannelType; autoDetected: boolean }
type DeviceConfig = { channels: Record<string, { name: string; type: ChannelType }> }
type AudioConfig = Record<string, DeviceConfig>

type CaptureSession = {
  process: ChildProcess
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

// Kendte professionelle interfaces og deres typiske kanal-layout
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
        else if (i <= 18) { name = `SP/DIF ${i === 17 ? "L" : "R"}`; type = "input" }
        else if (i === 19) { name = "Mon L"; type = "output" }
        else if (i === 20) { name = "Mon R"; type = "output" }
        else if (i === 21) { name = "HP 1 L"; type = "output" }
        else if (i === 22) { name = "HP 1 R"; type = "output" }
        else if (i === 23) { name = "HP 2 L"; type = "output" }
        else if (i === 24) { name = "HP 2 R"; type = "output" }
        else if (i === 25) { name = "Loopback L"; type = "input" }
        else if (i === 26) { name = "Loopback R"; type = "input" }
        else if (i === 27) { name = "Loopback 2 L"; type = "input" }
        else if (i === 28) { name = "Loopback 2 R"; type = "input" }
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
    // Macs built-in mic/speaker
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
    if (known.match.test(deviceName)) {
      return known.getChannels(total)
    }
  }
  // Generic fallback: enkelt-kanal enheder er alt input, multi-kanal: første halvdel input, anden halvdel output
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

  // Start med auto-detect
  const auto = autoDetectChannels(deviceName, total)

  // Override med config hvis den eksisterer
  if (deviceConfig?.channels) {
    return auto.map(ch => {
      const override = deviceConfig.channels[String(ch.channel)]
      if (override) return { ...ch, ...override, autoDetected: false }
      return ch
    })
  }

  return auto
}

/* ---- FFMPEG HELPERS ---- */

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

function listAudioDevices(): Promise<Array<{ index: number; name: string; channels: number }>> {
  return new Promise((resolve) => {
    // ✅ Swift binary – lister enheder via CoreAudio
    const proc = spawn("/Users/petersandager/EASYCOM/easycom-host/server/src/audio_capture_bin", [
      "0", "48000", "2"
    ], { stdio: ["ignore", "pipe", "pipe"] })
    let output = ""
    proc.stderr.on("data", (d: Buffer) => { output += d.toString() })
    // Kill after we have device list
    setTimeout(() => { try { proc.kill() } catch {} }, 2000)
    proc.on("close", () => {
      const devices: Array<{ index: number; name: string; channels: number }> = []
      const lines = output.split("\n")
      let inList = false
      for (const line of lines) {
        if (line.trim() === "DEVICES_START") { inList = true; continue }
        if (line.trim() === "DEVICES_END")   { inList = false; continue }
        if (inList) {
          // Format: DEVICE:index:name:channels
          const m = line.match(/^DEVICE:(\d+):(.+):(\d+)$/)
          if (m) {
            const ch = parseInt(m[3])
            if (ch > 0) // only input devices
              devices.push({ index: parseInt(m[1]), name: m[2].trim(), channels: ch })
          }
        }
      }
      console.log("🎛️  Lydenheder:", devices.map(d => `[${d.index}] ${d.name} (${d.channels}ch)`).join(", "))
      resolve(devices)
    })
  })
}

function getDeviceChannels(deviceIndex: number): Promise<number> {
  // Swift binary reports channels in CAPTURE_START line
  // This function is kept for compatibility but Swift handles channels directly
  return Promise.resolve(30) // Apollo has 30 channels
}

/* ---- SETUP ---- */

export function setupAudioCapture(io: Server) {

  if (!checkFfmpeg()) {
    console.warn("⚠️  ffmpeg ikke fundet – kør: brew install ffmpeg")
    io.on("connection", (socket) => {
      socket.on("audio:devices:list", (cb) => cb({ ok: false, error: "ffmpeg ikke installeret" }))
    })
    return
  }

  console.log("✅ ffmpeg fundet – audio capture bridge klar")

  io.on("connection", (socket) => {

    /* LIST DEVICES */
    socket.on("audio:devices:list", async (cb) => {
      try {
        const rawDevices = await listAudioDevices()
        if (!rawDevices.length) { cb({ ok: false, error: "Ingen lydenheder fundet" }); return }

        const devices = await Promise.all(rawDevices.map(async (d) => {
          const totalChannels = await getDeviceChannels(d.index)
          const channelInfo = buildChannelInfo(d.name, totalChannels)
          const isApollo = /universal audio|apollo/i.test(d.name)
          return {
            index: d.index,
            name: d.name,
            channels: totalChannels,
            channelInfo,
            sampleRate: 48000,
            isApollo
          }
        }))

        cb({ ok: true, devices })
      } catch (e: any) { cb({ ok: false, error: e.message }) }
    })

    /* START CAPTURE */
    socket.on("audio:capture:start", ({ deviceIndex, deviceName = "", sampleRate = 48000 }, cb) => {
      stopSession(socket.id)
      console.log(`🎙️  Starter capture: device ${deviceIndex} (${deviceName}) @ ${sampleRate}Hz`)

      try {
        // ✅ Swift CoreAudio capture – stable multi-channel, no ffmpeg
        const proc = spawn("/Users/petersandager/EASYCOM/easycom-host/server/src/audio_capture_bin", [
          String(deviceIndex),
          String(sampleRate),
          "30"
        ], { stdio: ["ignore", "pipe", "pipe"] })

        let totalChannels = 2
        let headerParsed = false
        let callbackSent = false
        let buffer = Buffer.alloc(0)

        proc.stderr.on("data", (data: Buffer) => {
          const text = data.toString()
          // ✅ Parse Swift output: CAPTURE_START:deviceName:channels
          const swiftMatch = text.match(/CAPTURE_START:[^:]+:(\d+)/)
          if (swiftMatch && !headerParsed) {
            totalChannels = parseInt(swiftMatch[1])
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

          // Only process when we have at least CHUNK_SAMPLES frames
          while (buffer.length >= minBytes) {
            const frameCount = Math.floor(Math.min(buffer.length, minBytes * 2) / frameSize)

            // Deinterleave all channels first, then emit ONE event so all channels
            // always arrive together — prevents per-channel phase offset on the bridge client
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

        proc.on("error", (err) => {
          socket.emit("audio:capture:error", { error: err.message })
          stopSession(socket.id)
        })

        proc.on("close", (code) => {
          if (code !== 0 && code !== null)
            socket.emit("audio:capture:error", { error: `ffmpeg stoppet (kode ${code})` })
          sessions.delete(socket.id)
        })

        sessions.set(socket.id, { process: proc, deviceIndex, totalChannels, sampleRate })

      } catch (e: any) { cb?.({ ok: false, error: e.message }) }
    })

    /* SAVE CHANNEL CONFIG (fra UI) */
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
