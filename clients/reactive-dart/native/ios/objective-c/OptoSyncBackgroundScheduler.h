#import <BackgroundTasks/BackgroundTasks.h>
#import <Flutter/Flutter.h>
#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

typedef FlutterEngine * _Nonnull (^OptoSyncFlutterEngineFactory)(void);

/// Objective-C counterpart to the Swift BGProcessingTask adapter.
@interface OptoSyncBackgroundScheduler : NSObject

- (instancetype)initWithIdentifier:(NSString *)identifier
                budgetMilliseconds:(NSInteger)budgetMilliseconds
                      engineFactory:(OptoSyncFlutterEngineFactory)engineFactory
    NS_DESIGNATED_INITIALIZER;

- (instancetype)init NS_UNAVAILABLE;

/// Register once during application launch. A second registration is invalid.
- (BOOL)registerTask;

/// Submission is discretionary; iOS may run it later or not at all.
- (BOOL)scheduleAfter:(nullable NSDate *)earliestBeginDate
                error:(NSError * _Nullable * _Nullable)error;

@end

NS_ASSUME_NONNULL_END
