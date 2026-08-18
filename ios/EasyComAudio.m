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

RCT_EXPORT_METHOD(configureForStereo) {
  RTCAudioSessionConfiguration *config = [[RTCAudioSessionConfiguration alloc] init];
  config.category = AVAudioSessionCategoryPlayAndRecord;
  config.categoryOptions = AVAudioSessionCategoryOptionDefaultToSpeaker |
                           AVAudioSessionCategoryOptionAllowBluetoothA2DP |
                           AVAudioSessionCategoryOptionAllowBluetooth;
  config.mode = AVAudioSessionModeDefault;

  [RTCAudioSessionConfiguration setWebRTCConfiguration:config];

  RTCAudioSession *session = [RTCAudioSession sharedInstance];
  [session lockForConfiguration];
  NSError *error = nil;
  [session setConfiguration:config active:YES error:&error];
  [session unlockForConfiguration];

  NSLog(@"[EasyComAudio] %@ configured", error ? [NSString stringWithFormat:@"❌ %@", error] : @"✅");

  if (self.routeChangeObserver) return;
  __weak typeof(self) weakSelf = self;
  self.routeChangeObserver = [[NSNotificationCenter defaultCenter]
    addObserverForName:AVAudioSessionRouteChangeNotification
                object:[AVAudioSession sharedInstance]
                 queue:[NSOperationQueue mainQueue]
            usingBlock:^(NSNotification *note) {
              NSInteger reason = [note.userInfo[AVAudioSessionRouteChangeReasonKey] integerValue];
              if (reason != AVAudioSessionRouteChangeReasonNewDeviceAvailable &&
                  reason != AVAudioSessionRouteChangeReasonOldDeviceUnavailable) return;
              NSString *reasonStr = reason == AVAudioSessionRouteChangeReasonNewDeviceAvailable
                ? @"newDevice" : @"deviceRemoved";
              NSLog(@"[EasyComAudio] route change: %@", reasonStr);
              [weakSelf sendEventWithName:@"EasyComAudioRouteChange" body:@{@"reason": reasonStr}];
            }];
}

- (void)dealloc {
  if (self.routeChangeObserver) {
    [[NSNotificationCenter defaultCenter] removeObserver:self.routeChangeObserver];
  }
}

@end
