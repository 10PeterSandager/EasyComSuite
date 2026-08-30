#import "MIDIController.h"
#import <CoreMIDI/CoreMIDI.h>
#import <MediaPlayer/MediaPlayer.h>

// MIDI note assignments (must match easycom_remote.ino)
#define NOTE_TB1     60
#define NOTE_TB2     61
#define NOTE_TB3     62
#define NOTE_TB4     63
#define NOTE_VOL_UP  64
#define NOTE_VOL_DN  65
#define VOLUME_STEP  0.06f

static MIDIClientRef  _midiClient    = 0;
static MIDIPortRef    _midiInputPort = 0;

// MPVolumeView must live in the view hierarchy to function — keep one instance
static MPVolumeView  *_volumeView    = nil;
static UISlider      *_volumeSlider  = nil;

// Forward-declare private methods so the static C callbacks below can call them
@interface MIDIController ()
- (void)connectAllSources;
- (void)changeVolume:(float)delta;
- (void)setupVolumeSlider;
@end

// ─── CoreMIDI packet callback ─────────────────────────────────────────────
static void MIDICallback(const MIDIPacketList *pktList,
                         void *readRefCon,
                         void __unused *srcRefCon) {
  MIDIController *ctrl = (__bridge MIDIController *)readRefCon;
  const MIDIPacket *pkt = &pktList->packet[0];

  for (UInt32 i = 0; i < pktList->numPackets; i++) {
    if (pkt->length >= 3) {
      uint8_t status = pkt->data[0] & 0xF0;
      uint8_t note   = pkt->data[1];
      uint8_t vel    = pkt->data[2];

      BOOL on  = (status == 0x90) && vel > 0;
      BOOL off = (status == 0x80) || ((status == 0x90) && vel == 0);

      if (on) {
        if (note >= NOTE_TB1 && note <= NOTE_TB4) {
          [ctrl sendEventWithName:@"MIDITalkPress"
                             body:@{@"note": @(note)}];
        } else if (note == NOTE_VOL_UP) {
          [ctrl changeVolume:+VOLUME_STEP];
        } else if (note == NOTE_VOL_DN) {
          [ctrl changeVolume:-VOLUME_STEP];
        }
      } else if (off) {
        if (note >= NOTE_TB1 && note <= NOTE_TB4) {
          [ctrl sendEventWithName:@"MIDITalkRelease"
                             body:@{@"note": @(note)}];
        }
      }
    }
    pkt = MIDIPacketNext(pkt);
  }
}

// ─── CoreMIDI notification callback (hot-plug) ────────────────────────────
static void MIDINotifyCallback(const MIDINotification *msg, void *refCon) {
  if (msg->messageID == kMIDIMsgObjectAdded) {
    MIDIController *ctrl = (__bridge MIDIController *)refCon;
    // Small delay — device needs a moment to register its endpoints
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 200 * NSEC_PER_MSEC),
                   dispatch_get_main_queue(), ^{
      [ctrl connectAllSources];
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────
@implementation MIDIController

RCT_EXPORT_MODULE();

+ (BOOL)requiresMainQueueSetup { return YES; }

- (NSArray<NSString *> *)supportedEvents {
  return @[@"MIDITalkPress", @"MIDITalkRelease"];
}

- (instancetype)init {
  if (self = [super init]) {
    [self setupMIDI];
  }
  return self;
}

- (void)setupMIDI {
  OSStatus s = MIDIClientCreate(CFSTR("EasyCom"),
                                MIDINotifyCallback,
                                (__bridge void *)self,
                                &_midiClient);
  if (s != noErr) {
    NSLog(@"[MIDI] MIDIClientCreate failed: %d", (int)s);
    return;
  }
  MIDIInputPortCreate(_midiClient,
                      CFSTR("EasyComInput"),
                      MIDICallback,
                      (__bridge void *)self,
                      &_midiInputPort);
  [self connectAllSources];
  [self setupVolumeSlider];
}

// Connect every currently-visible MIDI source (USB-MIDI device)
- (void)connectAllSources {
  ItemCount n = MIDIGetNumberOfSources();
  for (ItemCount i = 0; i < n; i++) {
    MIDIEndpointRef src = MIDIGetSource(i);
    MIDIPortConnectSource(_midiInputPort, src, NULL);
  }
  NSLog(@"[MIDI] connected %lu source(s)", (unsigned long)n);
}

// MPVolumeView must be in the view hierarchy; hide it off-screen
- (void)setupVolumeSlider {
  dispatch_async(dispatch_get_main_queue(), ^{
    _volumeView = [[MPVolumeView alloc]
                   initWithFrame:CGRectMake(-3000, -3000, 1, 1)];
    UIWindow *win = [UIApplication sharedApplication].windows.firstObject;
    [win addSubview:_volumeView];
    for (UIView *v in _volumeView.subviews) {
      if ([v isKindOfClass:[UISlider class]]) {
        _volumeSlider = (UISlider *)v;
        break;
      }
    }
  });
}

- (void)changeVolume:(float)delta {
  dispatch_async(dispatch_get_main_queue(), ^{
    if (!_volumeSlider) return;
    float next = MAX(0.0f, MIN(1.0f, _volumeSlider.value + delta));
    [_volumeSlider setValue:next animated:NO];
    [_volumeSlider sendActionsForControlEvents:UIControlEventTouchUpInside];
  });
}

@end
