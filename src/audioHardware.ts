import os from "os"

export interface AudioDevice {

  id: string
  name: string
  inputs: number
  outputs: number

}

const devices: AudioDevice[] = []

export function registerDevice(device: AudioDevice) {

  devices.push(device)

}

export function getDevices() {

  return devices

}