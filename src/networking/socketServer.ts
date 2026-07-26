import { Server as HTTPServer } from "http"
import { Server } from "socket.io"

import {
  ClientToServerEvents,
  ServerToClientEvents
} from "../contracts/socketEvents"

import { registerEventHandlers } from "./eventRouter"

export function createSocketServer(httpServer: HTTPServer) {

  const io = new Server<
    ClientToServerEvents,
    ServerToClientEvents
  >(httpServer, {
    cors: {
      origin: "*"
    }
  })

  io.on("connection", (socket) => {

    registerEventHandlers(socket)

  })

  return io

}