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

    private FlutterEngine engine;

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
            startDrain(context, callbackHandle, dispatcherHandle, completer);
            return "opto-sync-drain";
        });
    }

    private void startDrain(
            Context context,
            long callbackHandle,
            long dispatcherHandle,
            CallbackToFutureAdapter.Completer<Result> future) {
        final Handler main = new Handler(Looper.getMainLooper());
        main.post(() -> {
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
                                future.set(Boolean.TRUE.equals(value)
                                        ? Result.success()
                                        : Result.retry());
                            }

                            @Override
                            public void error(@NonNull String code, String message, Object details) {
                                future.set(Result.retry());
                            }

                            @Override
                            public void notImplemented() {
                                future.set(Result.retry());
                            }
                        });
            });

            final FlutterCallbackInformation dispatcher =
                    FlutterCallbackInformation.lookupCallbackInformation(dispatcherHandle);
            if (dispatcher == null) {
                future.set(Result.failure());
                return;
            }
            engine.getDartExecutor().executeDartCallback(new DartExecutor.DartCallback(
                    context.getAssets(), loader.findAppBundlePath(), dispatcher));

            main.postDelayed(() -> {
                if (!future.isDone()) future.set(Result.retry());
            }, DRAIN_TIMEOUT_MILLIS);
        });

        future.addListener(this::tearDown, main::post);
        return future;
    }

    @Override
    public void onStopped() {
        new Handler(Looper.getMainLooper()).post(this::tearDown);
    }

    private void tearDown() {
        if (engine != null) {
            engine.destroy();
            engine = null;
        }
    }
}
