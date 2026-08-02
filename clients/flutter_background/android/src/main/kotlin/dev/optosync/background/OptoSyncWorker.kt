package dev.optosync.background

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.embedding.engine.dart.DartExecutor
import io.flutter.embedding.engine.loader.FlutterLoader
import io.flutter.plugin.common.MethodChannel
import io.flutter.view.FlutterCallbackInformation
import java.util.concurrent.atomic.AtomicBoolean
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout

/**
 * Runs the registered Dart drain callback in a headless background
 * FlutterEngine. Failures and remaining work retry with WorkManager's
 * exponential backoff, but persistent failures stop after [MAX_ATTEMPTS].
 */
class OptoSyncWorker(
    context: Context,
    parameters: WorkerParameters,
) : CoroutineWorker(context, parameters) {

    override suspend fun doWork(): Result {
        val callbackHandle =
            OptoSyncBackgroundPlugin.storedCallbackHandle(applicationContext)
        val dispatcherHandle =
            OptoSyncBackgroundPlugin.storedDispatcherHandle(applicationContext)
        if (callbackHandle == 0L || dispatcherHandle == 0L) return Result.failure()

        return try {
            withContext(Dispatchers.Main.immediate) {
                val loader = FlutterLoader()
                loader.startInitialization(applicationContext)
                loader.ensureInitializationComplete(applicationContext, null)

                val engine = FlutterEngine(applicationContext)
                try {
                    val drained = CompletableDeferred<Boolean>()
                    val started = AtomicBoolean(false)
                    val backgroundChannel = MethodChannel(
                        engine.dartExecutor.binaryMessenger,
                        "dev.optosync.background/background",
                    )
                    backgroundChannel.setMethodCallHandler { call, result ->
                        if (call.method != "backgroundChannelReady") {
                            result.notImplemented()
                            return@setMethodCallHandler
                        }
                        result.success(null)
                        if (!started.compareAndSet(false, true)) {
                            return@setMethodCallHandler
                        }
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
                                    // Do not retain platform error strings: an
                                    // application callback may include secrets.
                                    drained.completeExceptionally(
                                        RuntimeException("background drain failed"),
                                    )
                                }

                                override fun notImplemented() {
                                    drained.completeExceptionally(
                                        IllegalStateException("runDrain not implemented"),
                                    )
                                }
                            },
                        )
                    }

                    val dispatcher =
                        FlutterCallbackInformation.lookupCallbackInformation(dispatcherHandle)
                            ?: return@withContext Result.failure()
                    engine.dartExecutor.executeDartCallback(
                        DartExecutor.DartCallback(
                            applicationContext.assets,
                            loader.findAppBundlePath(),
                            dispatcher,
                        ),
                    )

                    val complete = withTimeout(DRAIN_TIMEOUT_MILLIS) { drained.await() }
                    if (complete) Result.success() else retryOrFail()
                } finally {
                    engine.destroy()
                }
            }
        } catch (_: TimeoutCancellationException) {
            retryOrFail()
        } catch (cancelled: CancellationException) {
            // WorkManager cancellation is ownership loss, not another failed
            // attempt. Propagating it prevents an unwanted retry after stop.
            throw cancelled
        } catch (_: Exception) {
            retryOrFail()
        }
    }

    private fun retryOrFail(): Result =
        if (runAttemptCount < MAX_ATTEMPTS - 1) {
            Result.retry()
        } else {
            Result.failure()
        }

    private companion object {
        const val DRAIN_TIMEOUT_MILLIS = 9 * 60 * 1000L // under the 10-min cap
        const val MAX_ATTEMPTS = 5
    }
}
