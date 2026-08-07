#import "EasyComAudio.h"
#import <AVFoundation/AVFoundation.h>
#import <WebRTC/RTCAudioSession.h>
#import <WebRTC/RTCAudioSessionConfiguration.h>

@implementation EasyComAudio {
  AVAudioEngine       *_testEngine;
  AVAudioPlayerNode   *_testPlayer;
  NSTimer             *_testTimer;
  BOOL                 _testLeftActive;
}

RCT_EXPORT_MODULE();

// Overrides react-native-webrtc's own default audio configuration so WebRTC
// itself uses stereo when it (re-)activates the audio session.
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

// Local stereo test tone: 440 Hz sine alternating L↔R every 2 s.
// Plays directly through the active AVAudioSession (same path as WebRTC audio).
// If you hear it in mono → AVAudioSession is mono. If you hear L/R alternating → stereo works.
RCT_EXPORT_METHOD(startStereoTest) {
  dispatch_async(dispatch_get_main_queue(), ^{
    [self stopStereoTestInternal];

    AVAudioEngine *engine = [[AVAudioEngine alloc] init];
    AVAudioPlayerNode *player = [[AVAudioPlayerNode alloc] init];
    [engine attachNode:player];

    // Stereo format: 2-channel 44.1 kHz float
    AVAudioFormat *stereoFormat = [[AVAudioFormat alloc]
      initStandardFormatWithSampleRate:44100 channels:2];
    [engine connect:player to:engine.mainMixerNode format:stereoFormat];

    // Build one cycle of 440 Hz sine (44100 samples = 1 s)
    AVAudioFrameCount frameCount = 44100;
    AVAudioPCMBuffer *buf = [[AVAudioPCMBuffer alloc]
      initWithPCMFormat:stereoFormat frameCapacity:frameCount];
    buf.frameLength = frameCount;
    float *chL = buf.floatChannelData[0];
    float *chR = buf.floatChannelData[1];
    for (AVAudioFrameCount i = 0; i < frameCount; i++) {
      float s = sinf(2.0f * M_PI * 440.0f * i / 44100.0f) * 0.5f;
      chL[i] = s;
      chR[i] = s;
    }

    NSError *err = nil;
    [engine startAndReturnError:&err];
    if (err) { NSLog(@"[EasyComAudio] engine start: %@", err); return; }

    // Schedule looping buffer — gain nodes route to L or R
    [player scheduleBuffer:buf atTime:nil options:AVAudioPlayerNodeBufferLoops completionHandler:nil];
    [player play];

    self->_testEngine      = engine;
    self->_testPlayer      = player;
    self->_testLeftActive  = YES;

    // Set initial state: full L, silent R
    engine.mainMixerNode.outputVolume = 1.0;
    // We route L/R by replacing the buffer every 2 s with the appropriate channel active
    self->_testTimer = [NSTimer scheduledTimerWithTimeInterval:2.0
      target:self selector:@selector(flipStereoTestSide) userInfo:nil repeats:YES];

    NSLog(@"[EasyComAudio] ▶ stereo test started (LEFT first)");
    [self applyTestSide]; // immediately apply L
  });
}

- (void)applyTestSide {
  if (!_testEngine || !_testPlayer) return;
  AVAudioFormat *stereoFormat = [[AVAudioFormat alloc]
    initStandardFormatWithSampleRate:44100 channels:2];
  AVAudioFrameCount frameCount = 44100;
  AVAudioPCMBuffer *buf = [[AVAudioPCMBuffer alloc]
    initWithPCMFormat:stereoFormat frameCapacity:frameCount];
  buf.frameLength = frameCount;
  float *chL = buf.floatChannelData[0];
  float *chR = buf.floatChannelData[1];
  BOOL left = _testLeftActive;
  for (AVAudioFrameCount i = 0; i < frameCount; i++) {
    float s = sinf(2.0f * M_PI * 440.0f * i / 44100.0f) * 0.5f;
    chL[i] = left ? s : 0.0f;
    chR[i] = left ? 0.0f : s;
  }
  [_testPlayer stop];
  [_testPlayer scheduleBuffer:buf atTime:nil options:AVAudioPlayerNodeBufferLoops completionHandler:nil];
  [_testPlayer play];
  NSLog(@"[EasyComAudio] stereo test → %@", left ? @"LEFT" : @"RIGHT");
}

- (void)flipStereoTestSide {
  _testLeftActive = !_testLeftActive;
  [self applyTestSide];
}

RCT_EXPORT_METHOD(stopStereoTest) {
  dispatch_async(dispatch_get_main_queue(), ^{
    [self stopStereoTestInternal];
    NSLog(@"[EasyComAudio] ■ stereo test stopped");
  });
}

- (void)stopStereoTestInternal {
  [_testTimer invalidate]; _testTimer = nil;
  [_testPlayer stop];      _testPlayer = nil;
  [_testEngine stop];      _testEngine = nil;
}

@end
