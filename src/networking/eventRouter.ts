import { Socket } from "socket.io"
import {
  ClientToServerEvents,
  ServerToClientEvents
} from "../contracts/socketEvents"

type EasyComSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents
>

export function registerEventHandlers(socket: EasyComSocket) {

  /* =========================
     CLIENT REGISTER
  ========================= */

  socket.on("register", (data: { id: string }) => {

    console.log("client registered:", data.id)

  })

  /* =========================
     TALK BUTTON
  ========================= */

  socket.on("talk", (data: { id: string; state: boolean }) => {

    console.log("talk:", data.id, data.state)

  })

  /* =========================
     MATRIX ROUTING
  ========================= */

  socket.on(
    "matrix_route",
    (data: { from: string; to: string; enabled: boolean }) => {

      console.log("matrix route:", data)

    }
  )

  /* =========================
     OPUS AUDIO FRAME
  ========================= */

  socket.on(
    "opus_frame",
    (data: { clientId: string; packet: Buffer; seq: number }) => {

      console.log("audio frame from:", data.clientId)

    }
  )

  /* =========================
     DISCONNECT
  ========================= */

  socket.on("disconnect", () => {

    console.log("client disconnected:", socket.id)

  })

}