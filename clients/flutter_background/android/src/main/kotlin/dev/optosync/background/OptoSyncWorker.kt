package dev.optosync.background

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.embedding.engine.dart.DartExecutor
import io.flutter.embedding.engine.loader.FlutterLoader
import io.flutter.plugin.common.MethodChannel
import io.flutter.view.FlutterCallbackInformation
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout

/**
 * Runs the registered Dart drain callback in a headless background
 * FlutterEngine. Returns [Result.retry] (WorkManager exponential backoff)
 * when the drain fails or reports remaining work.
 */
class OptoSyncWorker(
    context: Context,
    parameters: WorkerParameters,
) : CoroutineWorker(context, parameters) {

    override suspend fun doWork(): Result {
        val callbackHandle = OptoSyncBackgroundPlugin.storedCallbackHandle(applicationContext)
        if (callbackHandle == 0L) return Result.failure()

        return withContext(Dispatchers.Main) {
            val loader = FlutterLoader()
            loader.startInitialization(applicationContext)
            loader.ensureInitializationComplete(applicationContext, null)

            val engine = FlutterEngine(applicationContext)
            try {
                val drained = CompletableDeferred<Boolean>()
                val backgroundChannel = MethodChannel(
                    engine.dartExecutor.binaryMessenger,
                    "dev.optosync.background/background",
                )
                backgroundChannel.setMethodCallHandler { call, result ->
                    if (call.method == "backgroundChannelReady") {
                        result.success(null)
                        backgroundChannel.invokeMethod(
                            "runDrain",
                            mapOf("callbackHandle" to callbackHandle),
                            object : MethodChannel.Result {
                                override fun success(value: Any?) {
                                    drained.complete(value == true)
                                }

                                override fun error(
                                    code: String,
                                    message: String?,
                                    details: Any?,
                                ) {
                                    drained.completeExceptionally(
                                        RuntimeException("$code: $message"),
                                    )
                                }

                                override fun notImplemented() {
                                    drained.completeExceptionally(
                                        IllegalStateException("runDrain not implemented"),
                                    )
                                }
                            },
                        )
                    } else {
                        result.notImplemented()
                    }
                }

                // setupBackgroundChannel is the Dart-side @pragma('vm:entry-point').
                val entrypoint = FlutterCallbackInformation.lookupCallbackInformation(callbackHandle)
                    ?: return@withContext Result.failure()
                engine.dartExecutor.executeDartCallback(
                    DartExecutor.DartCallback(
                        applicationContext.assets,
                        loader.findAppBundlePath(),
                        FlutterCallbackInformation.lookupCallbackInformation(
                            DrainEntrypoint.setupHandle(applicationContext, entrypoint),
                        ),
                    ),
                )

                val complete = withTimeout(DRAIN_TIMEOUT_MILLIS) { drained.await() }
                if (complete) Result.success() else Result.retry()
            } catch (error: Exception) {
                Result.retry()
            } finally {
                engine.destroy()
            }
        }
    }

    private companion object {
        const val DRAIN_TIMEOUT_MILLIS = 9 * 60 * 1000L // under the 10-min cap
    }
}
