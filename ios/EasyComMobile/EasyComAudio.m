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

// Overrides react-native-webrtc's own default audio configuration.
//
// IMPORTANT: We do NOT call setConfiguration:active:YES here. Calling active:YES
// directly takes ownership of the AVAudioSession away from WebRTC's internal lifecycle
// manager. When AirPods connect, iOS fires a route-change interrupt — WebRTC handles
// this via RTCAudioSessionDelegate, stops and restarts the RemoteIO audio unit.
// If we own the session (active:YES), the interrupt handling in WebRTC can put the audio
// unit into an inconsistent state → EXC_BAD_ACCESS crash.
//
// Instead: set the WebRTC default config so that whenever WebRTC (re-)activates the
// session (e.g. after a route change), it uses our stereo/A2DP settings.
//
RCT_EXPORT_METHOD(configureForStereo) {
  RTCAudioSessionConfiguration *config = [[RTCAudioSessionConfiguration alloc] init];
  config.category = AVAudioSessionCategoryPlayAndRecord;
  config.categoryOptions = AVAudioSessionCategoryOptionDefaultToSpeaker |
                           AVAudioSessionCategoryOptionAllowBluetoothA2DP;
  config.mode = AVAudioSessionModeDefault;

  // Register as WebRTC's default config — applied every time WebRTC activates audio.
  [RTCAudioSessionConfiguration setWebRTCConfiguration:config];

  // Apply to the live session without claiming ownership (no active:YES).
  RTCAudioSession *session = [RTCAudioSession sharedInstance];
  [session lockForConfiguration];
  NSError *error = nil;
  [session setConfiguration:config error:&error];
  if (error) { NSLog(@"[EasyComAudio] setConfiguration: %@", error); }
  [session unlockForConfiguration];

  // Subscribe to route changes so JS can gracefully pause/resume tracks.
  [self startRouteChangeObserver];

  NSLog(@"[EasyComAudio] stereo config set (Default mode, A2DP only) — WebRTC manages activation");
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

              // Re-assert our config AFTER WebRTC finishes handling the route change.
              dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 300 * NSEC_PER_MSEC),
                             dispatch_get_main_queue(), ^{
                [weakSelf reapplyConfig];
              });

              // Notify JS — JS will briefly disable tracks during the transition.
              [weakSelf sendEventWithName:@"EasyComAudioRouteChange" body:@{@"reason": reasonStr}];
            }];
}

- (void)reapplyConfig {
  RTCAudioSessionConfiguration *config = [[RTCAudioSessionConfiguration alloc] init];
  config.category = AVAudioSessionCategoryPlayAndRecord;
  config.categoryOptions = AVAudioSessionCategoryOptionDefaultToSpeaker |
                           AVAudioSessionCategoryOptionAllowBluetoothA2DP;
  config.mode = AVAudioSessionModeDefault;
  [RTCAudioSessionConfiguration setWebRTCConfiguration:config];

  RTCAudioSession *session = [RTCAudioSession sharedInstance];
  [session lockForConfiguration];
  NSError *error = nil;
  [session setConfiguration:config error:&error];
  if (error) { NSLog(@"[EasyComAudio] reapplyConfig error: %@", error); }
  [session unlockForConfiguration];
  NSLog(@"[EasyComAudio] config re-applied after route change");
}

- (void)dealloc {
  if (self.routeChangeObserver) {
    [[NSNotificationCenter defaultCenter] removeObserver:self.routeChangeObserver];
  }
}

@end
