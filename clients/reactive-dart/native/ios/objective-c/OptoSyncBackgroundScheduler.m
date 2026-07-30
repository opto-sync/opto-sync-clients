#import "OptoSyncBackgroundScheduler.h"

static NSString * const OptoSyncBackgroundChannel = @"opto-sync/background";

@interface OptoSyncBackgroundScheduler ()
@property(nonatomic, copy) NSString *identifier;
@property(nonatomic, assign) NSInteger budgetMilliseconds;
@property(nonatomic, copy) OptoSyncFlutterEngineFactory engineFactory;
@end

@implementation OptoSyncBackgroundScheduler

- (instancetype)initWithIdentifier:(NSString *)identifier
                budgetMilliseconds:(NSInteger)budgetMilliseconds
                      engineFactory:(OptoSyncFlutterEngineFactory)engineFactory {
  NSParameterAssert(identifier.length > 0);
  NSParameterAssert(budgetMilliseconds >= 1000 && budgetMilliseconds <= 600000);
  self = [super init];
  if (self) {
    _identifier = [identifier copy];
    _budgetMilliseconds = budgetMilliseconds;
    _engineFactory = [engineFactory copy];
  }
  return self;
}

- (BOOL)registerTask {
  __weak typeof(self) weakSelf = self;
  return [[BGTaskScheduler sharedScheduler]
      registerForTaskWithIdentifier:self.identifier
                         usingQueue:nil
                      launchHandler:^(__kindof BGTask *task) {
    __strong typeof(weakSelf) self = weakSelf;
    if (!self || ![task isKindOfClass:[BGProcessingTask class]]) {
      [task setTaskCompletedWithSuccess:NO];
      return;
    }
    [self handleTask:(BGProcessingTask *)task];
  }];
}

- (BOOL)scheduleAfter:(NSDate *)earliestBeginDate error:(NSError **)error {
  BGProcessingTaskRequest *request =
      [[BGProcessingTaskRequest alloc] initWithIdentifier:self.identifier];
  request.requiresNetworkConnectivity = YES;
  request.requiresExternalPower = NO;
  request.earliestBeginDate = earliestBeginDate;
  return [[BGTaskScheduler sharedScheduler] submitTaskRequest:request error:error];
}

- (void)handleTask:(BGProcessingTask *)task {
  FlutterEngine *engine = self.engineFactory();
  FlutterMethodChannel *channel = [FlutterMethodChannel
      methodChannelWithName:OptoSyncBackgroundChannel
            binaryMessenger:engine.binaryMessenger];
  __block BOOL completed = NO;
  void (^complete)(BOOL) = ^(BOOL success) {
    @synchronized (task) {
      if (completed) return;
      completed = YES;
      [task setTaskCompletedWithSuccess:success];
      [engine destroyContext];
    }
  };

  task.expirationHandler = ^{
    [channel invokeMethod:@"cancel" arguments:nil];
    complete(NO);
  };

  if (![engine runWithEntrypoint:@"optoSyncBackgroundMain"]) {
    complete(NO);
    return;
  }
  [channel invokeMethod:@"runOnce"
              arguments:@{ @"budgetMilliseconds": @(self.budgetMilliseconds) }
                 result:^(id _Nullable result) {
    complete(![result isKindOfClass:[FlutterError class]]);
  }];
}

@end
