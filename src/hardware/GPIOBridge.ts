import dgram from "dgram"

interface GPIOConfig {
  id: number
  ip: string
  port: number
  protocol: "UDP" | "TCP"
  label: string
}

export class GPIOBridge {

  private socket = dgram.createSocket("udp4")
  private configs = new Map<number, GPIOConfig>()

  register(config: GPIOConfig) {
    this.configs.set(config.id, config)
  }

  trigger(id: number, message = "CMD_BT_ON") {

    const cfg = this.configs.get(id)
    if (!cfg) return

    const buf = Buffer.from(message)

    this.socket.send(buf, cfg.port, cfg.ip)

  }

  release(id: number) {

    const cfg = this.configs.get(id)
    if (!cfg) return

    const buf = Buffer.from("CMD_BT_OFF")

    this.socket.send(buf, cfg.port, cfg.ip)

  }

}