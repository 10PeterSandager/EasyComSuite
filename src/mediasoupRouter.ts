import * as mediasoup from "mediasoup"

let worker: mediasoup.types.Worker
let router: mediasoup.types.Router

export async function startMediasoup() {

worker = await mediasoup.createWorker({
rtcMinPort: 40000,
rtcMaxPort: 40100
})

worker.on("died", () => {

console.error("mediasoup worker died")

process.exit(1)

})

router = await worker.createRouter({
mediaCodecs: [
{
kind: "audio",
mimeType: "audio/opus",
clockRate: 48000,
channels: 2
},
{
kind: "video",
mimeType: "video/VP8",
clockRate: 90000,
parameters: { "x-google-start-bitrate": 1000 }
},
{
kind: "video",
mimeType: "video/H264",
clockRate: 90000,
parameters: {
"packetization-mode": 1,
"profile-level-id": "42e01f",
"level-asymmetry-allowed": 1
}
}
]
})

console.log("Mediasoup router created")

}

export function getRouter() {
return router
}