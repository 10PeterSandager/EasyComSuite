// AudioCapture.swift – CoreAudio multi-channel capture
// Captures from a specific audio device and outputs raw PCM s16le to stdout
// Usage: AudioCapture <deviceIndex> <sampleRate> <channels>

import Foundation
import CoreAudio
import AudioToolbox
import AVFoundation

// ─── Arguments ────────────────────────────────────────────────────────────────
let args = CommandLine.arguments
guard args.count >= 4 else {
    fputs("Usage: AudioCapture <deviceIndex> <sampleRate> <channels>\n", stderr)
    exit(1)
}

let targetDeviceIndex = Int(args[1]) ?? 0
let sampleRate        = Double(args[2]) ?? 48000.0
let numChannels       = Int(args[3]) ?? 30

// ─── List devices ─────────────────────────────────────────────────────────────
func getAudioDevices() -> [(id: AudioDeviceID, name: String, inputs: Int)] {
    var propSize: UInt32 = 0
    var addr = AudioObjectPropertyAddress(
        mSelector: kAudioHardwarePropertyDevices,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain
    )
    AudioObjectGetPropertyDataSize(AudioObjectID(kAudioObjectSystemObject), &addr, 0, nil, &propSize)
    let count = Int(propSize) / MemoryLayout<AudioDeviceID>.size
    var deviceIDs = [AudioDeviceID](repeating: 0, count: count)
    AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &addr, 0, nil, &propSize, &deviceIDs)

    return deviceIDs.enumerated().compactMap { (idx, deviceID) in
        // Get name
        var nameSize = UInt32(MemoryLayout<CFString?>.size)
        var nameAddr = AudioObjectPropertyAddress(
            mSelector: kAudioDevicePropertyDeviceNameCFString,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        var name: CFString = "" as CFString
        AudioObjectGetPropertyData(deviceID, &nameAddr, 0, nil, &nameSize, &name)

        // Get input channels
        var streamSize: UInt32 = 0
        var streamAddr = AudioObjectPropertyAddress(
            mSelector: kAudioDevicePropertyStreamConfiguration,
            mScope: kAudioDevicePropertyScopeInput,
            mElement: kAudioObjectPropertyElementMain
        )
        AudioObjectGetPropertyDataSize(deviceID, &streamAddr, 0, nil, &streamSize)
        let bufferList = UnsafeMutableRawPointer.allocate(byteCount: Int(streamSize), alignment: MemoryLayout<AudioBufferList>.alignment)
        defer { bufferList.deallocate() }
        AudioObjectGetPropertyData(deviceID, &streamAddr, 0, nil, &streamSize, bufferList)
        let abl = bufferList.assumingMemoryBound(to: AudioBufferList.self)
        var totalInputs = 0
        let buffers = UnsafeBufferPointer<AudioBuffer>(start: &abl.pointee.mBuffers, count: Int(abl.pointee.mNumberBuffers))
        for buf in buffers { totalInputs += Int(buf.mNumberChannels) }

        return (id: deviceID, name: name as String, inputs: totalInputs)
    }
}

// Request mic permission if not yet determined (needed when running without an app bundle)
let authStatus = AVCaptureDevice.authorizationStatus(for: .audio)
if authStatus == .notDetermined {
    let micSem = DispatchSemaphore(value: 0)
    AVCaptureDevice.requestAccess(for: .audio) { granted in
        fputs(granted ? "MIC_GRANTED\n" : "MIC_DENIED\n", stderr)
        micSem.signal()
    }
    _ = micSem.wait(timeout: .now() + 8)
} else if authStatus == .denied || authStatus == .restricted {
    fputs("ERROR: Microphone access denied by TCC\n", stderr)
    exit(1)
}

let devices = getAudioDevices()

// Print device list to stderr so server can parse it
fputs("DEVICES_START\n", stderr)
for (idx, dev) in devices.enumerated() {
    fputs("DEVICE:\(idx):\(dev.name):\(dev.inputs)\n", stderr)
}
fputs("DEVICES_END\n", stderr)

guard targetDeviceIndex < devices.count else {
    fputs("ERROR: Device index \(targetDeviceIndex) not found\n", stderr)
    exit(1)
}

let targetDevice = devices[targetDeviceIndex]
fputs("CAPTURE_START:\(targetDevice.name):\(targetDevice.inputs)\n", stderr)

// ─── Audio Queue capture ───────────────────────────────────────────────────────
let actualChannels = min(numChannels, targetDevice.inputs)
let bufferDuration = 0.01  // 10ms per buffer
let bufferSize     = Int(sampleRate * bufferDuration) * actualChannels * 2  // s16le

var format = AudioStreamBasicDescription(
    mSampleRate:       sampleRate,
    mFormatID:         kAudioFormatLinearPCM,
    mFormatFlags:      kAudioFormatFlagIsSignedInteger | kAudioFormatFlagIsPacked,
    mBytesPerPacket:   UInt32(actualChannels * 2),
    mFramesPerPacket:  1,
    mBytesPerFrame:    UInt32(actualChannels * 2),
    mChannelsPerFrame: UInt32(actualChannels),
    mBitsPerChannel:   16,
    mReserved:         0
)

// Callback – writes raw PCM to stdout
let callback: AudioQueueInputCallback = { (
    inUserData, inAQ, inBuffer, inStartTime, inNumPackets, inPacketDesc
) in
    guard inNumPackets > 0 else { return }
    let data = Data(bytes: inBuffer.pointee.mAudioData, count: Int(inBuffer.pointee.mAudioDataByteSize))
    _ = data.withUnsafeBytes { ptr in
        write(STDOUT_FILENO, ptr.baseAddress!, data.count)
    }
    AudioQueueEnqueueBuffer(inAQ, inBuffer, 0, nil)
}

var queue: AudioQueueRef?
var err = AudioQueueNewInput(&format, callback, nil, nil, nil, 0, &queue)
guard err == noErr, let q = queue else {
    fputs("ERROR: AudioQueueNewInput failed: \(err)\n", stderr)
    exit(1)
}

// Set the device
var deviceID = targetDevice.id
var propAddr = AudioObjectPropertyAddress(
    mSelector: kAudioQueueProperty_CurrentDevice,
    mScope: kAudioObjectPropertyScopeGlobal,
    mElement: kAudioObjectPropertyElementMain
)
err = AudioQueueSetProperty(q, kAudioQueueProperty_CurrentDevice, &deviceID, UInt32(MemoryLayout<AudioDeviceID>.size))
if err != noErr {
    fputs("WARN: Could not set device, using default: \(err)\n", stderr)
}

// Allocate and enqueue buffers (3 rotating buffers)
let numBuffers = 3
for _ in 0..<numBuffers {
    var buf: AudioQueueBufferRef?
    AudioQueueAllocateBuffer(q, UInt32(bufferSize), &buf)
    if let b = buf { AudioQueueEnqueueBuffer(q, b, 0, nil) }
}

// Start
err = AudioQueueStart(q, nil)
guard err == noErr else {
    fputs("ERROR: AudioQueueStart failed: \(err)\n", stderr)
    exit(1)
}

fputs("CAPTURE_READY\n", stderr)

// Keep running until signal
signal(SIGTERM) { _ in exit(0) }
signal(SIGINT)  { _ in exit(0) }

RunLoop.main.run()
