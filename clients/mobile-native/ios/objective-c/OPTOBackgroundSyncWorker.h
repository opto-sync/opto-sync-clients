#import <BackgroundTasks/BackgroundTasks.h>
#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

API_AVAILABLE(ios(13.0))
typedef void (^OPTOBackgroundSyncCompletion)(BOOL success);

API_AVAILABLE(ios(13.0))
typedef void (^OPTOBackgroundSyncRunBlock)(
    BOOL (^isCancelled)(void),
    OPTOBackgroundSyncCompletion completion
);

API_AVAILABLE(ios(13.0))
@interface OPTOBackgroundSyncWorker : NSObject

@property(nonatomic, readonly, copy) NSString *refreshIdentifier;
@property(nonatomic, readonly, copy) NSString *processingIdentifier;

- (instancetype)init NS_UNAVAILABLE;

- (instancetype)initWithRefreshIdentifier:(NSString *)refreshIdentifier
                     processingIdentifier:(NSString *)processingIdentifier
                           refreshInterval:(NSTimeInterval)refreshInterval
                                  runBlock:(OPTOBackgroundSyncRunBlock)runBlock
    NS_DESIGNATED_INITIALIZER;

/// Register during application launch and list both identifiers in
/// BGTaskSchedulerPermittedIdentifiers.
- (BOOL)registerTasks;

- (void)scheduleRefresh;
- (void)scheduleProcessing;
- (void)cancelAll;

@end

NS_ASSUME_NONNULL_END
