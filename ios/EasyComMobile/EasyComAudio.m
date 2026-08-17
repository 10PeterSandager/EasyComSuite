#import "EasyComAudio.h"
#import <AVFoundation/AVFoundation.h>
#import <WebRTC/RTCAudioSession.h>
#import <WebRTC/RTCAudioSessionConfiguration.h>

@interface EasyComAudio ()
@property (nonatomic, strong) id routeChangeObserver;
@end

@implementation EasyComAudio

RCT_EXPORT_MODULE();

+ (BOOL)requiresMainQueueSetup { return NO; }

- (NSArray<NSString *> *)supportedEvents {
  return @[@"EasyComAudioRouteChange"];
}

// Configures AVAudioSession for stereo A2DP (AirPods) output.
//
// Calling setConfiguration:active:YES via WebRTC's own lockForConfiguration mechanism
// is safe — it does not steal session ownership from WebRTC, it goes through WebRTC's
// own thread-safe locking. This is required so the config takes effect on the ALREADY-
// ACTIVE session (WebRTC has activated it via getUserMedia by the second call in App.tsx).
//
// The original AirPods crash was caused by the route-change observer calling
// InCallManager.start({media:'video'}) which forced VoiceProcessingIO, conflicting with
// our RemoteIO stereo pipeline. That call is removed — route changes are handled here.
//
RCT_EXPORT_METHOD(configureForStereo) {
  [self applyConfig:YES];
  [self startRouteChangeObserver];
}

- (void)applyConfig:(BOOL)activate {
  RTCAudioSessionConfiguration *config = [[RTCAudioSessionConfiguration alloc] init];
  config.category = AVAudioSessionCategoryPlayAndRecord;
  config.categoryOptions = AVAudioSessionCategoryOptionDefaultToSpeaker |
                           AVAudioSessionCategoryOptionAllowBluetoothA2DP;
  config.mode = AVAudioSessionModeDefault;

  // Register as WebRTC's default — applied on every future WebRTC (re-)activation.
  [RTCAudioSessionConfiguration setWebRTCConfiguration:config];

  // Also apply to the live session through WebRTC's own thread-safe lock.
  RTCAudioSession *session = [RTCAudioSession sharedInstance];
  [session lockForConfiguration];
  NSError *error = nil;
  [session setConfiguration:config active:activate error:&error];
  if (error) { NSLog(@"[EasyComAudio] applyConfig(active=%d): %@", activate, error); }
  [session unlockForConfiguration];

  NSLog(@"[EasyComAudio] %@ stereo config (Default/A2DP, active=%d)",
        error ? @"❌" : @"✅", activate);
}

- (void)startRouteChangeObserver {
  if (self.routeChangeObserver) return;
  __weak typeof(self) weakSelf = self;
  self.routeChangeObserver = [[NSNotificationCenter defaultCenter]
    addObserverForName:AVAudioSessionRouteChangeNotification
                object:[AVAudioSession sharedInstance]
                 queue:[NSOperationQueue mainQueue]
            usingBlock:^(NSNotification *note) {
              NSInteger reason = [note.userInfo[AVAudioSessionRouteChangeReasonKey] integerValue];
              NSString *reasonStr = @"unknown";
              if (reason == AVAudioSessionRouteChangeReasonNewDeviceAvailable)   reasonStr = @"newDevice";
              if (reason == AVAudioSessionRouteChangeReasonOldDeviceUnavailable) reasonStr = @"deviceRemoved";
              NSLog(@"[EasyComAudio] route change: %@", reasonStr);

              // Notify JS immediately so tracks can be briefly paused during transition.
              [weakSelf sendEventWithName:@"EasyComAudioRouteChange" body:@{@"reason": reasonStr}];

              // Re-assert stereo config 400ms after the route change, after WebRTC's
              // own RTCAudioSessionDelegate fires and finishes restarting the audio unit.
              // Do NOT call InCallManager here — that forces VoiceProcessingIO (mono).
              dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 400 * NSEC_PER_MSEC),
                             dispatch_get_main_queue(), ^{
                [weakSelf applyConfig:NO];  // config only, WebRTC manages active state after restart
              });
            }];
}

- (void)dealloc {
  if (self.routeChangeObserver) {
    [[NSNotificationCenter defaultCenter] removeObserver:self.routeChangeObserver];
  }
}

@end
