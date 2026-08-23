#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

FOUNDATION_EXPORT NSNotificationName const OptoSyncConnectivityDidChangeNotification;
FOUNDATION_EXPORT NSString * const OptoSyncConnectivityStateKey;
FOUNDATION_EXPORT NSString * const OptoSyncConnectivityModeKey;
FOUNDATION_EXPORT NSString * const OptoSyncConnectivitySourceKey;
FOUNDATION_EXPORT NSString * const OptoSyncConnectivityChangedAtKey;
FOUNDATION_EXPORT NSString * const OptoSyncConnectivityVerifiedAtKey;

/// Objective-C facade for the Swift NWPathMonitor implementation.
@interface OptoSyncConnectivityBridge : NSObject

+ (void)start;
+ (void)stop;
+ (void)setTotalOffline:(BOOL)enabled;
+ (void)configureProbeURLString:(nullable NSString *)urlString
           timeoutMilliseconds:(NSInteger)timeoutMilliseconds;
+ (void)refresh;
+ (NSDictionary<NSString *, id> *)snapshot;

@end

NS_ASSUME_NONNULL_END
