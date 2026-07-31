package dev.optosync.background;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import androidx.annotation.NonNull;
import androidx.concurrent.futures.CallbackToFutureAdapter;
import androidx.work.Constraints;
import androidx.work.ExistingWorkPolicy;
import androidx.work.ListenableWorker;
import androidx.work.NetworkType;
import androidx.work.OneTimeWorkRequest;
import androidx.work.WorkManager;
import androidx.work.WorkerParameters;
import com.google.common.util.concurrent.ListenableFuture;
import io.flutter.FlutterInjector;
import io.flutter.embedding.engine.FlutterEngine;
import io.flutter.embedding.engine.dart.DartExecutor;
import io.flutter.plugin.common.MethodChannel;
import java.util.Collections;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Consumer;

/** Java/CallbackToFutureAdapter equivalent of the Kotlin CoroutineWorker. */
public final class OptoSyncWorker extends ListenableWorker {
  public static final String UNIQUE_WORK_NAME = "opto-sync-background";
  private static final String CHANNEL_NAME = "opto-sync/background";
  private static final long BUDGET_MILLIS = 25_000L;
  private static final int MAX_ATTEMPTS = 5;

  private volatile FlutterEngine engine;
  private volatile MethodChannel channel;

  public OptoSyncWorker(
      @NonNull Context appContext,
      @NonNull WorkerParameters workerParams) {
    super(appContext, workerParams);
  }

  @NonNull
  @Override
  public ListenableFuture<Result> startWork() {
    return CallbackToFutureAdapter.getFuture(completer -> {
      final AtomicBoolean completed = new AtomicBoolean(false);
      final AtomicBoolean runStarted = new AtomicBoolean(false);
      final Context context = getApplicationContext();
      final Handler mainHandler = new Handler(Looper.getMainLooper());
      final Runnable[] timeout = new Runnable[1];
      final io.flutter.embedding.engine.loader.FlutterLoader loader =
          FlutterInjector.instance().flutterLoader();
      loader.startInitialization(context);
      loader.ensureInitializationComplete(context, null);
      engine = new FlutterEngine(context);
      channel = new MethodChannel(
          engine.getDartExecutor().getBinaryMessenger(),
          CHANNEL_NAME);

      final Consumer<Result> finish = workerResult -> {
        if (!completed.compareAndSet(false, true)) return;
        if (timeout[0] != null) mainHandler.removeCallbacks(timeout[0]);
        final MethodChannel active = channel;
        if (active != null) active.setMethodCallHandler(null);
        destroyEngine();
        completer.set(workerResult);
      };
      final Runnable failOrRetry = () -> finish.accept(
          getRunAttemptCount() < MAX_ATTEMPTS
              ? Result.retry()
              : Result.failure());
      final Runnable beginRunAfterDartIsReady = () -> {
        if (!runStarted.compareAndSet(false, true) || completed.get()) return;
        final MethodChannel active = channel;
        if (active == null) {
          failOrRetry.run();
          return;
        }
        active.invokeMethod(
            "runOnce",
            Collections.singletonMap("budgetMilliseconds", BUDGET_MILLIS),
            new MethodChannel.Result() {
              @Override
              public void success(Object result) {
                finish.accept(Result.success());
              }

              @Override
              public void error(String code, String message, Object details) {
                failOrRetry.run();
              }

              @Override
              public void notImplemented() {
                failOrRetry.run();
              }
            });
      };

      channel.setMethodCallHandler((call, result) -> {
        if (!"ready".equals(call.method)) {
          result.notImplemented();
          return;
        }
        result.success(null);
        beginRunAfterDartIsReady.run();
      });
      completer.addCancellationListener(() -> {
        if (!completed.compareAndSet(false, true)) return;
        if (timeout[0] != null) mainHandler.removeCallbacks(timeout[0]);
        final MethodChannel active = channel;
        if (active != null) {
          active.invokeMethod("cancel", null);
          active.setMethodCallHandler(null);
        }
        destroyEngine();
      }, command -> mainHandler.post(command));

      final DartExecutor.DartEntrypoint entrypoint =
          new DartExecutor.DartEntrypoint(
              loader.findAppBundlePath(),
              "optoSyncBackgroundMain");
      engine.getDartExecutor().executeDartEntrypoint(entrypoint);

      timeout[0] = () -> {
        final MethodChannel active = channel;
        if (active != null) active.invokeMethod("cancel", null);
        failOrRetry.run();
      };
      mainHandler.postDelayed(timeout[0], BUDGET_MILLIS);
      return "opto-sync bounded Flutter protocol cycle";
    });
  }

  @Override
  public void onStopped() {
    final MethodChannel active = channel;
    if (active != null) {
      active.invokeMethod("cancel", null);
      active.setMethodCallHandler(null);
    }
    destroyEngine();
    super.onStopped();
  }

  private synchronized void destroyEngine() {
    if (engine != null) {
      engine.destroy();
      engine = null;
      channel = null;
    }
  }

  public static void enqueue(Context context, long initialDelayMinutes) {
    final Constraints constraints = new Constraints.Builder()
        .setRequiredNetworkType(NetworkType.CONNECTED)
        .build();
    final OneTimeWorkRequest request =
        new OneTimeWorkRequest.Builder(OptoSyncWorker.class)
            .setConstraints(constraints)
            .setInitialDelay(Math.max(0L, initialDelayMinutes), TimeUnit.MINUTES)
            .build();
    WorkManager.getInstance(context).enqueueUniqueWork(
        UNIQUE_WORK_NAME,
        ExistingWorkPolicy.KEEP,
        request);
  }
}
