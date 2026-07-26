import WebSocket from "ws"

export class ClusterSync {

  private peers: WebSocket[] = []

  connect(url: string) {

    const ws = new WebSocket(url)

    ws.on("open", () => {
      console.log("cluster connected", url)
    })

    ws.on("message", (msg) => {
      this.onMessage(msg.toString())
    })

    this.peers.push(ws)

  }

  broadcast(data: any) {

    const msg = JSON.stringify(data)

    for (const peer of this.peers) {

      if (peer.readyState === WebSocket.OPEN) {
        peer.send(msg)
      }

    }

  }

  onMessage(msg: string) {

    const data = JSON.parse(msg)

    console.log("cluster state sync", data.type)

  }

}