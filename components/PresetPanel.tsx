import { useState } from "react"
import { savePreset, loadPreset, getPresets } from "../client/webrtc/intercom"

type Preset = {
  name: string
  routing: Record<number, string[]>
}

type Props = {
  myId: string
}

export default function PresetPanel({ myId }: Props) {

  const [name, setName] = useState("")
  const [list, setList] = useState<Preset[]>(getPresets())

  function save() {
    savePreset(name)
    setList([...getPresets()])
  }

  function load(n: string) {
    loadPreset(n, myId)
  }

  return (
    <div>
      <h3>Presets</h3>
      <input placeholder="Preset name" value={name} onChange={e => setName(e.target.value)} />
      <button onClick={save}>Save</button>
      {list.map((p: Preset) => (
        <div key={p.name}>
          {p.name}
          <button onClick={() => load(p.name)}>Load</button>
        </div>
      ))}
    </div>
  )
}