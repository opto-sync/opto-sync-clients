package dev.optosync.background

import android.content.Context
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import io.flutter.FlutterInjector
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.embedding.engine.dart.DartExecutor
import io.flutter.plugin.common.MethodCall
import io.flutter.plugin.common.MethodChannel
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.coroutines.resume

/**
 * Bounded WorkManager adapter. The Dart entrypoint restores auth from secure
 * storage and runs one idempotent HTTP push/pull cycle; it does not keep a
 * WebSocket/TCP connection alive after WorkManager stops this process.
 */
class OptoSyncWorker(
    appContext: Context,
    params: WorkerParameters,
) : CoroutineWorker(appContext, params) {
    override suspend fun doWork(): Result = try {
        val ok = withTimeout(BUDGET_MILLIS) { runFlutterCycle() }
        if (ok) Result.success() else retryOrFail()
    } catch (cancelled: CancellationException) {
        throw cancelled
    } catch (_: Throwable) {
        retryOrFail()
    }

    private fun retryOrFail(): Result =
        if (runAttemptCount < MAX_ATTEMPTS) Result.retry() else Result.failure()

    private suspend fun runFlutterCycle(): Boolean =
        withContext(Dispatchers.Main.immediate) {
            suspendCancellableCoroutine { continuation ->
                val loader = FlutterInjector.instance().flutterLoader()
                loader.startInitialization(applicationContext)
                loader.ensureInitializationComplete(applicationContext, null)
                val engine = FlutterEngine(applicationContext)
                val channel = MethodChannel(
                    engine.dartExecutor.binaryMessenger,
                    CHANNEL_NAME,
                )
                val finished = AtomicBoolean(false)
                val started = AtomicBoolean(false)

                fun finish(success: Boolean) {
                    if (!finished.compareAndSet(false, true)) return
                    channel.setMethodCallHandler(null)
                    engine.destroy()
                    if (continuation.isActive) continuation.resume(success)
                }

                fun startCycleAfterReady() {
                    if (!started.compareAndSet(false, true) || finished.get()) return
                    channel.invokeMethod(
                        "runOnce",
                        mapOf("budgetMilliseconds" to BUDGET_MILLIS),
                        object : MethodChannel.Result {
                            override fun success(result: Any?) = finish(true)

                            override fun error(
                                code: String,
                                message: String?,
                                details: Any?,
                            ) = finish(false)

                            override fun notImplemented() = finish(false)
                        },
                    )
                }

                channel.setMethodCallHandler { call: MethodCall, result: MethodChannel.Result ->
                    if (call.method != "ready") {
                        result.notImplemented()
                    } else {
                        result.success(null)
                        startCycleAfterReady()
                    }
                }
                continuation.invokeOnCancellation {
                    if (!finished.compareAndSet(false, true)) return@invokeOnCancellation
                    channel.invokeMethod("cancel", null)
                    channel.setMethodCallHandler(null)
                    engine.destroy()
                }

                val entrypoint = DartExecutor.DartEntrypoint(
                    loader.findAppBundlePath(),
                    "optoSyncBackgroundMain",
                )
                engine.dartExecutor.executeDartEntrypoint(entrypoint)
            }
        }

    companion object {
        const val UNIQUE_WORK_NAME = "opto-sync-background"
        private const val CHANNEL_NAME = "opto-sync/background"
        private const val BUDGET_MILLIS = 25_000L
        private const val MAX_ATTEMPTS = 5

        fun enqueue(context: Context, initialDelayMinutes: Long = 0) {
            val constraints = Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .build()
            val request = OneTimeWorkRequestBuilder<OptoSyncWorker>()
                .setConstraints(constraints)
                .setInitialDelay(initialDelayMinutes.coerceAtLeast(0), TimeUnit.MINUTES)
                .build()
            WorkManager.getInstance(context).enqueueUniqueWork(
                UNIQUE_WORK_NAME,
                ExistingWorkPolicy.KEEP,
                request,
            )
        }
    }
}
