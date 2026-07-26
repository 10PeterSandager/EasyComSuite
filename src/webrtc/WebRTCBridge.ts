import { Server } from "socket.io"

export class WebRTCBridge {

  constructor(private io: Server) {}

  handle(socket: any) {

    socket.on("webrtc_offer", (data: any) => {

      this.io.to(data.target).emit("webrtc_offer", data)

    })

    socket.on("webrtc_answer", (data: any) => {

      this.io.to(data.target).emit("webrtc_answer", data)

    })

    socket.on("webrtc_candidate", (data: any) => {

      this.io.to(data.target).emit("webrtc_candidate", data)

    })

  }

}