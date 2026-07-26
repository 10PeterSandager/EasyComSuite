declare module "opusscript" {

  type VALID_SAMPLING_RATE =
    | 8000
    | 12000
    | 16000
    | 24000
    | 48000

  type VALID_CHANNELS =
    | 1
    | 2

  type VALID_APPLICATION =
    | 2048
    | 2049
    | 2051

  class OpusScript {

    static Application: {
      VOIP: VALID_APPLICATION
      AUDIO: VALID_APPLICATION
      RESTRICTED_LOWDELAY: VALID_APPLICATION
    }

    constructor(
      sampleRate: VALID_SAMPLING_RATE,
      channels: VALID_CHANNELS,
      application: VALID_APPLICATION
    )

    encode(
      pcm: Int16Array,
      frameSize: number
    ): Buffer

    decode(
      packet: Buffer,
      frameSize: number
    ): Int16Array

  }

  export = OpusScript

}