#import "OptoSyncConnectivity.h"

#if __has_include(<opto_sync_flutter_background/opto_sync_flutter_background-Swift.h>)
#import <opto_sync_flutter_background/opto_sync_flutter_background-Swift.h>
#else
#import "opto_sync_flutter_background-Swift.h"
#endif

NSNotificationName const OptoSyncConnectivityDidChangeNotification =
    @"OptoSyncConnectivityDidChangeNotification";
NSString * const OptoSyncConnectivityStateKey = @"state";
NSString * const OptoSyncConnectivityModeKey = @"mode";
NSString * const OptoSyncConnectivitySourceKey = @"source";
NSString * const OptoSyncConnectivityChangedAtKey = @"changedAt";
NSString * const OptoSyncConnectivityVerifiedAtKey = @"verifiedAt";

@implementation OptoSyncConnectivityBridge

+ (void)start {
  [[OptoSyncConnectivityWatcher shared] start];
}

+ (void)stop {
  [[OptoSyncConnectivityWatcher shared] stop];
}

+ (void)setTotalOffline:(BOOL)enabled {
  [[OptoSyncConnectivityWatcher shared] setTotalOffline:enabled];
}

+ (void)configureProbeURLString:(NSString *)urlString
           timeoutMilliseconds:(NSInteger)timeoutMilliseconds {
  [[OptoSyncConnectivityWatcher shared]
      configureProbeWithUrlString:urlString
      timeoutMilliseconds:timeoutMilliseconds];
}

+ (void)refresh {
  [[OptoSyncConnectivityWatcher shared] refresh];
}

+ (NSDictionary<NSString *, id> *)snapshot {
  return [[[OptoSyncConnectivityWatcher shared] snapshot] dictionary];
}

@end
