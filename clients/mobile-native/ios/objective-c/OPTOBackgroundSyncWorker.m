#import "OPTOBackgroundSyncWorker.h"

API_AVAILABLE(ios(13.0))
@interface OPTOCancellationState : NSObject
@property(nonatomic, readonly, getter=isCancelled) BOOL cancelled;
- (void)cancel;
@end

@implementation OPTOCancellationState {
    NSLock *_lock;
    BOOL _cancelled;
}

- (instancetype)init {
    self = [super init];
    if (self) {
        _lock = [[NSLock alloc] init];
    }
    return self;
}

- (BOOL)isCancelled {
    [_lock lock];
    BOOL value = _cancelled;
    [_lock unlock];
    return value;
}

- (void)cancel {
    [_lock lock];
    _cancelled = YES;
    [_lock unlock];
}

@end

API_AVAILABLE(ios(13.0))
@interface OPTOCompletionGate : NSObject
- (BOOL)claim;
@end

@implementation OPTOCompletionGate {
    NSLock *_lock;
    BOOL _claimed;
}

- (instancetype)init {
    self = [super init];
    if (self) {
        _lock = [[NSLock alloc] init];
    }
    return self;
}

- (BOOL)claim {
    [_lock lock];
    BOOL available = !_claimed;
    _claimed = YES;
    [_lock unlock];
    return available;
}

@end

@implementation OPTOBackgroundSyncWorker {
    NSTimeInterval _refreshInterval;
    OPTOBackgroundSyncRunBlock _runBlock;
}

- (instancetype)initWithRefreshIdentifier:(NSString *)refreshIdentifier
                     processingIdentifier:(NSString *)processingIdentifier
                           refreshInterval:(NSTimeInterval)refreshInterval
                                  runBlock:(OPTOBackgroundSyncRunBlock)runBlock {
    NSParameterAssert(refreshIdentifier.length > 0);
    NSParameterAssert(processingIdentifier.length > 0);
    NSParameterAssert(refreshInterval >= 15 * 60);
    NSParameterAssert(runBlock != nil);
    self = [super init];
    if (self) {
        _refreshIdentifier = [refreshIdentifier copy];
        _processingIdentifier = [processingIdentifier copy];
        _refreshInterval = refreshInterval;
        _runBlock = [runBlock copy];
    }
    return self;
}

- (BOOL)registerTasks {
    __weak typeof(self) weakSelf = self;
    BOOL refresh = [[BGTaskScheduler sharedScheduler]
        registerForTaskWithIdentifier:self.refreshIdentifier
                           usingQueue:nil
                        launchHandler:^(BGTask *task) {
        __strong typeof(weakSelf) self = weakSelf;
        if (self == nil || ![task isKindOfClass:[BGAppRefreshTask class]]) {
            [task setTaskCompletedWithSuccess:NO];
            return;
        }
        [self scheduleRefresh];
        [self handleTask:task];
    }];
    BOOL processing = [[BGTaskScheduler sharedScheduler]
        registerForTaskWithIdentifier:self.processingIdentifier
                           usingQueue:nil
                        launchHandler:^(BGTask *task) {
        __strong typeof(weakSelf) self = weakSelf;
        if (self == nil || ![task isKindOfClass:[BGProcessingTask class]]) {
            [task setTaskCompletedWithSuccess:NO];
            return;
        }
        [self scheduleProcessing];
        [self handleTask:task];
    }];
    return refresh && processing;
}

- (void)scheduleRefresh {
    BGAppRefreshTaskRequest *request = [[BGAppRefreshTaskRequest alloc]
        initWithIdentifier:self.refreshIdentifier];
    request.earliestBeginDate = [NSDate dateWithTimeIntervalSinceNow:_refreshInterval];
    [[BGTaskScheduler sharedScheduler] submitTaskRequest:request error:nil];
}

- (void)scheduleProcessing {
    BGProcessingTaskRequest *request = [[BGProcessingTaskRequest alloc]
        initWithIdentifier:self.processingIdentifier];
    request.requiresNetworkConnectivity = YES;
    request.requiresExternalPower = NO;
    [[BGTaskScheduler sharedScheduler] submitTaskRequest:request error:nil];
}

- (void)cancelAll {
    [[BGTaskScheduler sharedScheduler]
        cancelTaskRequestWithIdentifier:self.refreshIdentifier];
    [[BGTaskScheduler sharedScheduler]
        cancelTaskRequestWithIdentifier:self.processingIdentifier];
}

- (void)handleTask:(BGTask *)task {
    OPTOCancellationState *cancellation = [[OPTOCancellationState alloc] init];
    OPTOCompletionGate *gate = [[OPTOCompletionGate alloc] init];
    OPTOBackgroundSyncCompletion complete = ^(BOOL success) {
        if ([gate claim]) {
            [task setTaskCompletedWithSuccess:success && !cancellation.isCancelled];
        }
    };
    task.expirationHandler = ^{
        [cancellation cancel];
        complete(NO);
    };
    _runBlock(^BOOL {
        return cancellation.isCancelled;
    }, complete);
}

@end
