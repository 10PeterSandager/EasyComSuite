/**
 * audioOutputWorker.ts
 *
 * Spawned as a child process by audioOutput.ts so naudiodon/PortAudio
 * SIGSEGV cannot kill the main server.
 *
 * Args: node audioOutputWorker.js <deviceId> <deviceChannels> <hwChannel>
 *
 * Protocol:
 *   stdout: "READY:<port>\n"  when UDP socket + AudioIO are ready
 *           "ERROR:<msg>\n"   on failure
 *   stdin:  "stop\n"          triggers cleanup and exit
 */

import * as dgram from "dgram"

let OpusScript: any
let naudiodon: any
try { OpusScript = require("opusscript") } catch {}
try { naudiodon  = require("naudiodon")  } catch {}

const deviceId      = parseInt(process.argv[2])
const deviceChannels = parseInt(process.argv[3])
const hwChannel     = parseInt(process.argv[4])
const chIdx         = (hwChannel - 1) % deviceChannels

if (!OpusScript || !naudiodon) {
  process.stdout.write(`ERROR:missing opusscript or naudiodon\n`)
  process.exit(1)
}
if (isNaN(deviceId) || isNaN(deviceChannels) || deviceChannels < 1 || isNaN(hwChannel)) {
  process.stdout.write(`ERROR:invalid args: ${process.argv.slice(2).join(" ")}\n`)
  process.exit(1)
}

const rtpSocket = dgram.createSocket("udp4")
rtpSocket.bind(0, "127.0.0.1", () => {
  const port = (rtpSocket.address() as any).port as number

  let audioStream: any
  try {
    audioStream = new naudiodon.AudioIO({
      outOptions: {
        channelCount: deviceChannels,
        sampleFormat: naudiodon.SampleFormat16Bit,
        sampleRate: 48000,
        deviceId,
        closeOnError: false,
      },
    })
    audioStream.start()
  } catch (e: any) {
    process.stdout.write(`ERROR:AudioIO: ${e?.message ?? e}\n`)
    process.exit(1)
  }

  process.stdout.write(`READY:${port}\n`)

  const decoder   = new OpusScript(48000, 1)
  const FRAME_SIZE = 960

  rtpSocket.on("message", (msg: Buffer) => {
    try {
      if (msg.length < 12) return
      const cc     = msg[0] & 0x0f
      const hasExt = (msg[0] & 0x10) !== 0
      let hdrLen   = 12 + cc * 4
      if (hasExt && msg.length > hdrLen + 4) {
        hdrLen += 4 + msg.readUInt16BE(hdrLen + 2) * 4
      }
      const hasPad = (msg[0] & 0x20) !== 0
      let end = msg.length
      if (hasPad && end > hdrLen) end -= msg[end - 1]
      const payload = msg.slice(hdrLen, end)
      if (!payload.length) return

      const pcm: Int16Array = decoder.decode(payload, FRAME_SIZE)
      const outBuf = Buffer.allocUnsafe(pcm.length * deviceChannels * 2)
      for (let i = 0; i < pcm.length; i++) {
        for (let c = 0; c < deviceChannels; c++) {
          outBuf.writeInt16LE(c === chIdx ? pcm[i] : 0, (i * deviceChannels + c) * 2)
        }
      }
      audioStream.write(outBuf)
    } catch {}
  })

  const cleanup = () => {
    try { audioStream.quit() } catch {}
    try { rtpSocket.close()  } catch {}
    process.exit(0)
  }

  let stdinBuf = ""
  process.stdin.on("data", (d: Buffer) => {
    stdinBuf += d.toString()
    if (stdinBuf.includes("stop")) cleanup()
  })
  process.on("SIGTERM", cleanup)
  process.on("SIGINT",  cleanup)
})
