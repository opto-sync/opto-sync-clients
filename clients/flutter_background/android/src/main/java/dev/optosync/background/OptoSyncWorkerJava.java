package dev.optosync.background;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.concurrent.futures.CallbackToFutureAdapter;
import androidx.work.ListenableWorker;
import androidx.work.WorkerParameters;

import com.google.common.util.concurrent.ListenableFuture;

import java.util.Collections;
import java.util.concurrent.atomic.AtomicBoolean;

import io.flutter.FlutterInjector;
import io.flutter.embedding.engine.FlutterEngine;
import io.flutter.embedding.engine.dart.DartExecutor;
import io.flutter.embedding.engine.loader.FlutterLoader;
import io.flutter.plugin.common.MethodChannel;
import io.flutter.view.FlutterCallbackInformation;

/** Plain-Java background drain worker. */
public final class OptoSyncWorkerJava extends ListenableWorker {

    private static final long DISPATCHER_READY_TIMEOUT_MILLIS = 30L * 1000L;
    private static final long DRAIN_TIMEOUT_MILLIS = 8L * 60L * 1000L + 30L * 1000L;
    private static final int MAX_ATTEMPTS = 5;
    private static final String LOG_TAG = "OptoSyncBackground";

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
            if (OptoSyncBackgroundPlugin.isTotalOffline(context)) {
                Log.i(LOG_TAG, "Java worker skipped: total-offline mode is enabled");
                completer.set(Result.success());
                return "opto-sync-offline";
            }
            if (callbackHandle == 0L || dispatcherHandle == 0L) {
                Log.w(LOG_TAG, "Java worker rejected: callback registration is missing");
                completer.set(Result.failure());
                return "opto-sync-drain";
            }
            Log.i(LOG_TAG, "Java worker starting; attempt=" + getRunAttemptCount());
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
            if (isStopped()) return;
            try {
                final FlutterLoader loader = FlutterInjector.instance().flutterLoader();
                if (!loader.initialized()) loader.startInitialization(context);
                loader.ensureInitializationComplete(context, null);

                engine = new FlutterEngine(context);
                final AtomicBoolean started = new AtomicBoolean(false);
                final MethodChannel channel = new MethodChannel(
                        engine.getDartExecutor().getBinaryMessenger(),
                        "dev.optosync.background/background");
                channel.setMethodCallHandler((call, result) -> {
                    if (!"backgroundChannelReady".equals(call.method)) {
                        result.notImplemented();
                        return;
                    }
                    Log.i(LOG_TAG, "Java worker background Dart channel is ready");
                    result.success(null);
                    if (!started.compareAndSet(false, true)) return;
                    installTimeout(
                            main,
                            () -> {
                                Log.w(LOG_TAG, "Java worker background Dart drain timed out");
                                finish(completer, retryOrFail());
                            },
                            DRAIN_TIMEOUT_MILLIS);
                    channel.invokeMethod(
                            "runDrain",
                            Collections.singletonMap("callbackHandle", callbackHandle),
                            new MethodChannel.Result() {
                                @Override
                                public void success(Object value) {
                                    Log.i(LOG_TAG, "Java worker background Dart drain completed; drained="
                                            + Boolean.TRUE.equals(value));
                                    finish(completer, Boolean.TRUE.equals(value)
                                            ? Result.success()
                                            : retryOrFail());
                                }

                                @Override
                                public void error(
                                        @NonNull String code, String message, Object details) {
                                    Log.w(LOG_TAG, "Java worker background Dart drain reported failure");
                                    finish(completer, retryOrFail());
                                }

                                @Override
                                public void notImplemented() {
                                    Log.w(LOG_TAG, "Java worker background Dart drain was not implemented");
                                    finish(completer, retryOrFail());
                                }
                            });
                });

                final FlutterCallbackInformation dispatcher =
                        FlutterCallbackInformation.lookupCallbackInformation(dispatcherHandle);
                if (dispatcher == null) {
                    Log.w(LOG_TAG, "Java worker rejected: Dart dispatcher is unavailable");
                    finish(completer, Result.failure());
                    return;
                }

                installTimeout(
                        main,
                        () -> {
                            Log.w(LOG_TAG,
                                    "Java worker background Dart dispatcher did not become ready");
                            finish(completer, retryOrFail());
                        },
                        DISPATCHER_READY_TIMEOUT_MILLIS);
                Log.i(LOG_TAG, "Java worker launching background Dart dispatcher");
                engine.getDartExecutor().executeDartCallback(new DartExecutor.DartCallback(
                        context.getAssets(), loader.findAppBundlePath(), dispatcher));
            } catch (RuntimeException error) {
                Log.w(LOG_TAG, "Java worker failed before completion");
                finish(completer, retryOrFail());
            }
        });
    }

    private void installTimeout(Handler handler, Runnable task, long delayMillis) {
        final Handler previousHandler = timeoutHandler;
        final Runnable previousTask = timeoutTask;
        if (previousHandler != null && previousTask != null) {
            previousHandler.removeCallbacks(previousTask);
        }
        timeoutHandler = handler;
        timeoutTask = task;
        handler.postDelayed(task, delayMillis);
    }

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
        Log.i(LOG_TAG, "Java worker ownership was cancelled");
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
            Log.i(LOG_TAG, "Java worker background Flutter engine destroyed");
        }
    }
}
