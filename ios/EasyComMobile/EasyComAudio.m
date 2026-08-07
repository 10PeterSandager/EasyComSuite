#import "EasyComAudio.h"
#import <AVFoundation/AVFoundation.h>

@implementation EasyComAudio

RCT_EXPORT_MODULE();

// Configures AVAudioSession for stereo A2DP output (bypasses VoiceProcessingIO mono constraint).
//
// Key differences from InCallManager.start({ media: 'video' }):
//   mode:    Default  (not VideoChat) → uses standard RemoteIO, not VoiceProcessingIO
//   options: allowBluetoothA2DP only (no allowBluetooth) → AirPods stay in A2DP (stereo),
//            not switched to HFP (mono, 8-16kHz)
//   iPhone built-in mic is used for input; AirPods output only.
//
RCT_EXPORT_METHOD(configureForStereo) {
  AVAudioSession *session = [AVAudioSession sharedInstance];
  NSError *error = nil;

  [session setCategory:AVAudioSessionCategoryPlayAndRecord
           withOptions:AVAudioSessionCategoryOptionDefaultToSpeaker |
                       AVAudioSessionCategoryOptionAllowBluetoothA2DP
                 error:&error];
  if (error) { NSLog(@"[EasyComAudio] setCategory: %@", error); error = nil; }

  [session setMode:AVAudioSessionModeDefault error:&error];
  if (error) { NSLog(@"[EasyComAudio] setMode: %@", error); error = nil; }

  [session setActive:YES error:&error];
  if (error) { NSLog(@"[EasyComAudio] setActive: %@", error); }

  NSLog(@"[EasyComAudio] ✅ stereo session: Default mode, A2DP only, 48kHz");
}

@end
