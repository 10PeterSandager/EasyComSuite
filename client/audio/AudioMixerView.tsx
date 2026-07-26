import React, { useEffect, useState } from "react"
import { getAudioLevel } from '../webrtc/intercom'
import { Play, Square, Volume2 } from "lucide-react"

interface Props {
  clients: any[]
  theme: "orange" | "blue"
}

/* 🔥 GLOBAL TONE GENERATOR */
let toneOsc: OscillatorNode | null = null
let toneGain: GainNode | null = null
const ctx = new (window.AudioContext || (window as any).webkitAudioContext)()

function startTone(freq = 1000) {
  if (toneOsc) return

  toneOsc = ctx.createOscillator()
  toneGain = ctx.createGain()

  toneOsc.type = "sine"
  toneOsc.frequency.value = freq

  toneGain.gain.value = 0.2

  toneOsc.connect(toneGain)
  toneGain.connect(ctx.destination)

  toneOsc.start()
}

function stopTone() {
  if (!toneOsc) return
  toneOsc.stop()
  toneOsc.disconnect()
  toneGain?.disconnect()
  toneOsc = null
}

const AudioMixerView: React.FC<Props> = ({ clients, theme }) => {

  const themeColor = theme === "orange" ? "orange" : "blue"
  const [toneOn, setToneOn] = useState(false)

  const toggleTone = () => {
    if (toneOn) {
      stopTone()
      setToneOn(false)
    } else {
      startTone(1000) // 🔥 1kHz test tone
      setToneOn(true)
    }
  }

  return (

    <div className="h-full flex flex-col bg-zinc-950 p-4 gap-4">

      {/* 🔥 HEADER */}
      <div className="flex items-center justify-between">
        <h2 className="text-white font-black uppercase">Audio Mixer</h2>

        <button
          onClick={toggleTone}
          className={`flex items-center gap-2 px-4 py-2 rounded font-black ${
            toneOn ? "bg-red-600 text-white" : `bg-${themeColor}-600 text-white`
          }`}
        >
          {toneOn ? <Square size={14}/> : <Play size={14}/>}
          TEST TONE (1kHz)
        </button>
      </div>

      {/* 🔥 CHANNEL STRIPS */}
      <div className="flex-1 overflow-auto flex gap-3">

        {clients.map((c:any) => {

          const level = getAudioLevel(c.id)

          return (
            <div
              key={c.id}
              className="w-[90px] bg-zinc-900 border border-white/10 rounded-xl p-2 flex flex-col items-center gap-2"
            >

              {/* NAME */}
              <div className="text-[10px] text-white font-bold text-center truncate w-full">
                {c.name}
              </div>

              {/* LEVEL METER */}
              <div className="h-32 w-4 bg-black rounded overflow-hidden flex items-end">
                <div
                  className={`
                    w-full
                    ${level > 70 ? "bg-red-500" : level > 40 ? "bg-yellow-400" : "bg-green-500"}
                  `}
                  style={{ height: `${Math.min(100, level)}%` }}
                />
              </div>

              {/* GAIN */}
              <input
                type="range"
                min={0}
                max={100}
                value={c.gain}
                onChange={(e)=>{
                  const g = Number(e.target.value)
                  c.gain = g
                  import('../audio/AudioBridge').then(({ setChannelGain }) => {
                    setChannelGain(c.channel, g / 100)
                  })
                }}
                className={`w-full ${
                  theme === "orange" ? "orange-thumb" : "blue-thumb"
                }`}
              />

              {/* MUTE */}
              <button
                onClick={()=> c.isMuted = !c.isMuted}
                className={`w-full py-1 rounded text-xs ${
                  c.isMuted ? "bg-red-600" : "bg-zinc-700"
                }`}
              >
                MUTE
              </button>

            </div>
          )

        })}

      </div>

    </div>

  )

}

export default AudioMixerView