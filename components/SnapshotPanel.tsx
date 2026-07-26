import { useState, useEffect } from "react"
import { Save, FolderOpen, Trash2, Download, Upload } from "lucide-react"
import { Client } from "../types"

type Snapshot = {
  id: string
  name: string
  createdAt: string
  clients: Client[]
  connections: any[]
}

type Props = {
  clients: Client[]
  connections: any[]
  onRestore: (snapshot: Snapshot) => void
  theme?: "orange" | "blue"
}

const STORAGE_KEY = "easycom_snapshots"

export default function SnapshotPanel({ clients, connections, onRestore, theme = "orange" }: Props) {

  const [snapshots, setSnapshots] = useState<Snapshot[]>([])
  const [name, setName] = useState("")
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  const themeColor = theme === "orange" ? "orange" : "blue"

  /* ---------- LOAD FROM LOCALSTORAGE ---------- */

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) setSnapshots(JSON.parse(raw))
    } catch {}
  }, [])

  const persist = (list: Snapshot[]) => {
    setSnapshots(list)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list))
  }

  /* ---------- SAVE ---------- */

  const save = () => {
    if (!name.trim()) return

    const snapshot: Snapshot = {
      id: crypto.randomUUID(),
      name: name.trim(),
      createdAt: new Date().toLocaleString("da-DK"),
      clients: JSON.parse(JSON.stringify(clients)),
      connections: JSON.parse(JSON.stringify(connections))
    }

    persist([snapshot, ...snapshots])
    setName("")
  }

  /* ---------- DELETE ---------- */

  const remove = (id: string) => {
    persist(snapshots.filter(s => s.id !== id))
    setConfirmDelete(null)
  }

  /* ---------- EXPORT ---------- */

  const exportSnapshot = (s: Snapshot) => {
    const blob = new Blob([JSON.stringify(s, null, 2)], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `${s.name.replace(/\s+/g, "_")}_${s.createdAt.replace(/[/:, ]/g, "-")}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  /* ---------- IMPORT ---------- */

  const importSnapshot = () => {
    const input = document.createElement("input")
    input.type = "file"
    input.accept = ".json"
    input.onchange = async (e: any) => {
      try {
        const file = e.target.files[0]
        const text = await file.text()
        const s: Snapshot = JSON.parse(text)
        if (!s.id || !s.name || !s.clients) return
        s.id = crypto.randomUUID() // avoid ID conflicts
        persist([s, ...snapshots])
      } catch {
        alert("Kunne ikke importere snapshot – ugyldig fil")
      }
    }
    input.click()
  }

  /* ---------- RENDER ---------- */

  return (
    <div className="h-full flex flex-col">

      {/* HEADER */}
      <div className="px-4 py-3 border-b border-white/5 shrink-0">
        <h2 className="text-sm font-bold">Snapshots</h2>
        <p className="text-[10px] text-white/30">Gem og gendan komplette konfigurationer</p>
      </div>

      {/* SAVE NEW */}
      <div className="px-4 py-3 border-b border-white/5 shrink-0">
        <div className="flex gap-2">
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => e.key === "Enter" && save()}
            placeholder="Snapshot navn..."
            className="flex-1 px-3 py-2 bg-black border border-white/10 rounded text-xs"
          />
          <button
            onClick={save}
            disabled={!name.trim()}
            className={`px-3 py-2 rounded flex items-center gap-1 text-xs font-bold
              ${name.trim()
                ? `bg-${themeColor}-600 hover:bg-${themeColor}-500 text-white`
                : "bg-white/5 text-white/20 cursor-not-allowed"}
            `}
          >
            <Save size={12} /> Gem
          </button>
          <button
            onClick={importSnapshot}
            className="px-3 py-2 rounded bg-white/5 hover:bg-white/10 text-xs flex items-center gap-1"
            title="Importer snapshot fra fil"
          >
            <Upload size={12} />
          </button>
        </div>
      </div>

      {/* LIST */}
      <div className="flex-1 overflow-auto p-4 space-y-2">

        {snapshots.length === 0 && (
          <div className="text-center py-12 text-white/20 text-sm">
            Ingen snapshots gemt endnu
          </div>
        )}

        {snapshots.map(s => (
          <div
            key={s.id}
            className="bg-white/5 rounded-lg p-3 border border-white/5 hover:border-white/10 transition-colors"
          >
            <div className="flex items-start justify-between gap-2">

              <div>
                <p className="text-sm font-bold">{s.name}</p>
                <p className="text-[10px] text-white/30 mt-0.5">
                  {s.createdAt} · {s.clients.length} clients · {s.connections.length} forbindelser
                </p>
              </div>

              <div className="flex gap-1 shrink-0">

                {/* RESTORE */}
                <button
                  onClick={() => onRestore(s)}
                  className={`px-2 py-1 rounded text-[10px] font-bold bg-${themeColor}-600/20 hover:bg-${themeColor}-600/40 text-${themeColor}-400 flex items-center gap-1`}
                  title="Gendan denne snapshot"
                >
                  <FolderOpen size={11} /> Gendan
                </button>

                {/* EXPORT */}
                <button
                  onClick={() => exportSnapshot(s)}
                  className="p-1.5 rounded bg-white/5 hover:bg-white/10 text-white/40 hover:text-white"
                  title="Eksporter som JSON-fil"
                >
                  <Download size={11} />
                </button>

                {/* DELETE */}
                {confirmDelete === s.id ? (
                  <div className="flex gap-1 items-center">
                    <button
                      onClick={() => remove(s.id)}
                      className="px-2 py-1 rounded text-[10px] bg-red-600 text-white font-bold"
                    >
                      Slet
                    </button>
                    <button
                      onClick={() => setConfirmDelete(null)}
                      className="px-2 py-1 rounded text-[10px] bg-white/10 text-white/50"
                    >
                      Nej
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmDelete(s.id)}
                    className="p-1.5 rounded bg-white/5 hover:bg-red-600/30 text-white/40 hover:text-red-400"
                    title="Slet snapshot"
                  >
                    <Trash2 size={11} />
                  </button>
                )}

              </div>

            </div>
          </div>
        ))}

      </div>

    </div>
  )
}
