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
  __block BOOL runStarted = NO;

  void (^complete)(BOOL) = ^(BOOL success) {
    @synchronized (task) {
      if (completed) return;
      completed = YES;
    }
    dispatch_async(dispatch_get_main_queue(), ^{
      [channel setMethodCallHandler:nil];
      [task setTaskCompletedWithSuccess:success];
      [engine destroyContext];
    });
  };

  void (^beginRunAfterDartIsReady)(void) = ^{
    @synchronized (task) {
      if (completed || runStarted) return;
      runStarted = YES;
    }
    [channel invokeMethod:@"runOnce"
                arguments:@{ @"budgetMilliseconds": @(self.budgetMilliseconds) }
                   result:^(id _Nullable result) {
      complete(![result isKindOfClass:[FlutterError class]]);
    }];
  };

  [channel setMethodCallHandler:^(FlutterMethodCall *call, FlutterResult result) {
    if (![call.method isEqualToString:@"ready"]) {
      result(FlutterMethodNotImplemented);
      return;
    }
    result(nil);
    beginRunAfterDartIsReady();
  }];

  task.expirationHandler = ^{
    [channel invokeMethod:@"cancel" arguments:nil];
    complete(NO);
  };

  if (![engine runWithEntrypoint:@"optoSyncBackgroundMain"]) {
    complete(NO);
  }
}

@end
