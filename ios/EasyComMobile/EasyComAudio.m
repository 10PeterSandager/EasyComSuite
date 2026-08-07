#import "EasyComAudio.h"
#import <AVFoundation/AVFoundation.h>
#import <WebRTC/RTCAudioSession.h>
#import <WebRTC/RTCAudioSessionConfiguration.h>

@implementation EasyComAudio

RCT_EXPORT_MODULE();

// Overrides react-native-webrtc's own default audio configuration.
//
// The problem: react-native-webrtc internally calls
//   [RTCAudioSessionConfiguration setWebRTCConfiguration:] with a config that uses
//   AVAudioSessionModeVoiceChat (→ VoiceProcessingIO, mono) and
//   AVAudioSessionCategoryOptionAllowBluetooth (→ AirPods in HFP = mono 8-16kHz).
// This fires when WebRTC activates audio and overrides any direct AVAudioSession calls.
//
// The fix: call [RTCAudioSessionConfiguration setWebRTCConfiguration:] ourselves
// BEFORE WebRTC does, with:
//   mode:    Default     → RemoteIO audio unit (stereo, 48kHz, no VoiceProcessingIO)
//   options: A2DP only  → AirPods stay in stereo A2DP, not HFP
//            defaultToSpeaker → audio routes to speaker when no Bluetooth
//
RCT_EXPORT_METHOD(configureForStereo) {
  // 1. Override the WebRTC default config so it stays stereo even after WebRTC
  //    activates its audio session.
  RTCAudioSessionConfiguration *config = [[RTCAudioSessionConfiguration alloc] init];
  config.category = AVAudioSessionCategoryPlayAndRecord;
  config.categoryOptions = AVAudioSessionCategoryOptionDefaultToSpeaker |
                           AVAudioSessionCategoryOptionAllowBluetoothA2DP;
  config.mode = AVAudioSessionModeDefault;
  [RTCAudioSessionConfiguration setWebRTCConfiguration:config];

  // 2. Also apply directly to the live RTCAudioSession so the change takes effect now
  //    (not just on the next WebRTC audio activation).
  RTCAudioSession *audioSession = [RTCAudioSession sharedInstance];
  [audioSession lockForConfiguration];
  NSError *error = nil;
  [audioSession setConfiguration:config active:YES error:&error];
  if (error) { NSLog(@"[EasyComAudio] setConfiguration: %@", error); }
  [audioSession unlockForConfiguration];

  NSLog(@"[EasyComAudio] ✅ stereo session locked in: Default mode, A2DP only, 48kHz");
}

@end
