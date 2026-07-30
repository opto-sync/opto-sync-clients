#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

/// Objective-C registration shim for host apps without Swift.
///
/// Call from application:didFinishLaunchingWithOptions: BEFORE returning
/// (BGTaskScheduler requires launch-time registration):
///
///     #import <opto_sync_flutter_background/OptoSyncBackgroundBridge.h>
///     [OptoSyncBackgroundBridge registerTasks];
@interface OptoSyncBackgroundBridge : NSObject

+ (void)registerTasks;

@end

NS_ASSUME_NONNULL_END
