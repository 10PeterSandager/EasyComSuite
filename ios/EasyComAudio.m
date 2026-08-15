#import "EasyComAudio.h"
#import <AVFoundation/AVFoundation.h>
#import <WebRTC/RTCAudioSession.h>
#import <WebRTC/RTCAudioSessionConfiguration.h>

@implementation EasyComAudio

RCT_EXPORT_MODULE();

// Overrides react-native-webrtc's own default audio configuration.
//
// react-native-webrtc internally calls [RTCAudioSessionConfiguration setWebRTCConfiguration:]
// with AVAudioSessionModeVoiceChat (→ VoiceProcessingIO, mono) and AllowBluetooth (→ AirPods
// in HFP = mono 8-16kHz). This fires when WebRTC activates audio and overrides direct AVAudioSession calls.
//
// Fix: call [RTCAudioSessionConfiguration setWebRTCConfiguration:] ourselves BEFORE WebRTC does,
// with Default mode + A2DP only + DefaultToSpeaker.
RCT_EXPORT_METHOD(configureForStereo) {
  RTCAudioSessionConfiguration *config = [[RTCAudioSessionConfiguration alloc] init];
  config.category = AVAudioSessionCategoryPlayAndRecord;
  config.categoryOptions = AVAudioSessionCategoryOptionDefaultToSpeaker |
                           AVAudioSessionCategoryOptionAllowBluetoothA2DP;
  config.mode = AVAudioSessionModeDefault;
  [RTCAudioSessionConfiguration setWebRTCConfiguration:config];

  RTCAudioSession *audioSession = [RTCAudioSession sharedInstance];
  [audioSession lockForConfiguration];
  NSError *error = nil;
  [audioSession setConfiguration:config active:YES error:&error];
  if (error) { NSLog(@"[EasyComAudio] setConfiguration: %@", error); }
  [audioSession unlockForConfiguration];

  NSLog(@"[EasyComAudio] ✅ stereo session locked in: Default mode, A2DP only, 48kHz");
}

@end
