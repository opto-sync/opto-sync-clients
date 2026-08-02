package dev.optosync.background;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;

import androidx.annotation.NonNull;
import androidx.concurrent.futures.CallbackToFutureAdapter;
import androidx.work.ListenableWorker;
import androidx.work.WorkerParameters;

import com.google.common.util.concurrent.ListenableFuture;

import java.util.Collections;

import io.flutter.embedding.engine.FlutterEngine;
import io.flutter.embedding.engine.dart.DartExecutor;
import io.flutter.embedding.engine.loader.FlutterLoader;
import io.flutter.plugin.common.MethodChannel;
import io.flutter.view.FlutterCallbackInformation;

/**
 * Plain-Java variant of {@link OptoSyncWorker} for Java-only host apps that
 * schedule work themselves. Identical behavior: run the registered Dart drain
 * in a headless background FlutterEngine; retry with WorkManager's
 * exponential backoff on failure or remaining work.
 */
public final class OptoSyncWorkerJava extends ListenableWorker {

    private static final long DRAIN_TIMEOUT_MILLIS = 9L * 60L * 1000L;
    private static final int MAX_ATTEMPTS = 5;

    private FlutterEngine engine;
    private Handler timeoutHandler;
    private Runnable timeoutTask;

    public OptoSyncWorkerJava(@NonNull Context context, @NonNull WorkerParameters parameters) {
        super(context, parameters);
    }

    @NonNull
    @Override
    public ListenableFuture<Result> startWork() {
        final Context context = getApplicationContext();
        final long callbackHandle = OptoSyncBackgroundPlugin.storedCallbackHandle(context);
        final long dispatcherHandle = OptoSyncBackgroundPlugin.storedDispatcherHandle(context);

        return CallbackToFutureAdapter.getFuture(completer -> {
            if (callbackHandle == 0L || dispatcherHandle == 0L) {
                completer.set(Result.failure());
                return "opto-sync-drain";
            }
            // WorkManager cancels the returned future when ownership is lost.
            // Propagate that cancellation to the headless Flutter engine.
            final Handler main = new Handler(Looper.getMainLooper());
            completer.addCancellationListener(
                    this::cancelActiveWork,
                    command -> main.post(command));
            startDrain(context, callbackHandle, dispatcherHandle, completer);
            return "opto-sync-drain";
        });
    }

    private void startDrain(
            Context context,
            long callbackHandle,
            long dispatcherHandle,
            CallbackToFutureAdapter.Completer<Result> completer) {
        final Handler main = new Handler(Looper.getMainLooper());
        main.post(() -> {
            // Cancellation may win the race after startWork() returns but
            // before this main-thread launch runs. Do not create a headless
            // engine after WorkManager has already revoked ownership.
            if (isStopped()) return;
            try {
                final FlutterLoader loader = new FlutterLoader();
                loader.startInitialization(context);
                loader.ensureInitializationComplete(context, null);

                engine = new FlutterEngine(context);
                final MethodChannel channel = new MethodChannel(
                        engine.getDartExecutor().getBinaryMessenger(),
                        "dev.optosync.background/background");
                channel.setMethodCallHandler((call, result) -> {
                    if (!"backgroundChannelReady".equals(call.method)) {
                        result.notImplemented();
                        return;
                    }
                    result.success(null);
                    channel.invokeMethod(
                            "runDrain",
                            Collections.singletonMap("callbackHandle", callbackHandle),
                            new MethodChannel.Result() {
                                @Override
                                public void success(Object value) {
                                    finish(completer, Boolean.TRUE.equals(value)
                                            ? Result.success()
                                            : retryOrFail());
                                }

                                @Override
                                public void error(
                                        @NonNull String code, String message, Object details) {
                                    finish(completer, retryOrFail());
                                }

                                @Override
                                public void notImplemented() {
                                    finish(completer, retryOrFail());
                                }
                            });
                });

                final FlutterCallbackInformation dispatcher =
                        FlutterCallbackInformation.lookupCallbackInformation(dispatcherHandle);
                if (dispatcher == null) {
                    finish(completer, Result.failure());
                    return;
                }

                // Install the deadline before Dart can report readiness; a very
                // fast callback must still be able to remove it in finish().
                timeoutHandler = main;
                timeoutTask = () -> finish(completer, retryOrFail());
                main.postDelayed(timeoutTask, DRAIN_TIMEOUT_MILLIS);
                engine.getDartExecutor().executeDartCallback(new DartExecutor.DartCallback(
                        context.getAssets(), loader.findAppBundlePath(), dispatcher));
            } catch (RuntimeException error) {
                finish(completer, retryOrFail());
            }
        });
    }

    /** Completes the work exactly once and destroys the engine (main thread). */
    private void finish(CallbackToFutureAdapter.Completer<Result> completer, Result result) {
        final Handler handler = timeoutHandler;
        final Runnable task = timeoutTask;
        timeoutHandler = null;
        timeoutTask = null;
        if (handler != null && task != null) handler.removeCallbacks(task);
        if (completer.set(result)) tearDown();
    }

    @Override
    public void onStopped() {
        new Handler(Looper.getMainLooper()).post(this::cancelActiveWork);
        super.onStopped();
    }

    private void cancelActiveWork() {
        final Handler handler = timeoutHandler;
        final Runnable task = timeoutTask;
        timeoutHandler = null;
        timeoutTask = null;
        if (handler != null && task != null) handler.removeCallbacks(task);
        tearDown();
    }

    private Result retryOrFail() {
        return getRunAttemptCount() < MAX_ATTEMPTS - 1
                ? Result.retry()
                : Result.failure();
    }

    private void tearDown() {
        if (engine != null) {
            engine.destroy();
            engine = null;
        }
    }
}
