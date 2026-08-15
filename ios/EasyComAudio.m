#import "EasyComAudio.h"
#import <AVFoundation/AVFoundation.h>
#import <WebRTC/RTCAudioSession.h>
#import <WebRTC/RTCAudioSessionConfiguration.h>

@implementation EasyComAudio

RCT_EXPORT_MODULE();

static RTCAudioSessionConfiguration *_stereoConfig = nil;

+ (RTCAudioSessionConfiguration *)stereoConfig {
  if (!_stereoConfig) {
    _stereoConfig = [[RTCAudioSessionConfiguration alloc] init];
    _stereoConfig.category = AVAudioSessionCategoryPlayAndRecord;
    // AllowBluetooth: lets AirPods connect (HFP handshake required by iOS)
    // AllowBluetoothA2DP: iOS then uses A2DP (stereo) for output instead of HFP (mono)
    // DefaultToSpeaker: routes to speaker when no Bluetooth connected
    _stereoConfig.categoryOptions = AVAudioSessionCategoryOptionDefaultToSpeaker |
                                    AVAudioSessionCategoryOptionAllowBluetooth |
                                    AVAudioSessionCategoryOptionAllowBluetoothA2DP;
    _stereoConfig.mode = AVAudioSessionModeDefault;
  }
  return _stereoConfig;
}

+ (void)applyConfig {
  RTCAudioSession *audioSession = [RTCAudioSession sharedInstance];
  [audioSession lockForConfiguration];
  NSError *error = nil;
  [audioSession setConfiguration:[self stereoConfig] active:YES error:&error];
  if (error) { NSLog(@"[EasyComAudio] setConfiguration error: %@", error); }
  [audioSession unlockForConfiguration];
}

+ (void)handleRouteChange:(NSNotification *)notification {
  NSInteger reason = [notification.userInfo[AVAudioSessionRouteChangeReasonKey] integerValue];
  if (reason == AVAudioSessionRouteChangeReasonNewDeviceAvailable ||
      reason == AVAudioSessionRouteChangeReasonOldDeviceUnavailable ||
      reason == AVAudioSessionRouteChangeReasonCategoryChange) {
    [self applyConfig];
    NSLog(@"[EasyComAudio] 🔄 route change (reason %ld) — config re-applied", (long)reason);
  }
}

RCT_EXPORT_METHOD(configureForStereo) {
  // 1. Set as WebRTC's global default so it survives WebRTC session reactivation
  [RTCAudioSessionConfiguration setWebRTCConfiguration:[EasyComAudio stereoConfig]];

  // 2. Apply immediately
  [EasyComAudio applyConfig];

  // 3. Observe route changes (AirPods connecting after session is already active)
  [[NSNotificationCenter defaultCenter] removeObserver:[EasyComAudio class]
                                                  name:AVAudioSessionRouteChangeNotification
                                                object:nil];
  [[NSNotificationCenter defaultCenter] addObserver:[EasyComAudio class]
                                           selector:@selector(handleRouteChange:)
                                               name:AVAudioSessionRouteChangeNotification
                                             object:nil];

  NSLog(@"[EasyComAudio] ✅ configured: Default mode, HFP+A2DP, DefaultToSpeaker, route observer active");
}

@end
