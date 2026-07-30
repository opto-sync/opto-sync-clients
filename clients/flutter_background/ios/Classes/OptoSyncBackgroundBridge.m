#import "OptoSyncBackgroundBridge.h"

#if __has_include(<opto_sync_flutter_background/opto_sync_flutter_background-Swift.h>)
#import <opto_sync_flutter_background/opto_sync_flutter_background-Swift.h>
#else
#import "opto_sync_flutter_background-Swift.h"
#endif

@implementation OptoSyncBackgroundBridge

+ (void)registerTasks {
  [OptoSyncBackgroundPlugin registerTasks];
}

@end
