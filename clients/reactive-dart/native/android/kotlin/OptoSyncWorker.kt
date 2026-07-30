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
import io.flutter.plugin.common.MethodChannel
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeout
import java.util.concurrent.TimeUnit
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
    } catch (_: Throwable) {
        retryOrFail()
    }

    private fun retryOrFail(): Result =
        if (runAttemptCount < MAX_ATTEMPTS) Result.retry() else Result.failure()

    private suspend fun runFlutterCycle(): Boolean =
        suspendCancellableCoroutine { continuation ->
            val loader = FlutterInjector.instance().flutterLoader()
            loader.startInitialization(applicationContext)
            loader.ensureInitializationComplete(applicationContext, null)
            val engine = FlutterEngine(applicationContext)
            val entrypoint = DartExecutor.DartEntrypoint(
                loader.findAppBundlePath(),
                "optoSyncBackgroundMain",
            )
            engine.dartExecutor.executeDartEntrypoint(entrypoint)
            val channel = MethodChannel(
                engine.dartExecutor.binaryMessenger,
                CHANNEL_NAME,
            )
            continuation.invokeOnCancellation {
                channel.invokeMethod("cancel", null)
                engine.destroy()
            }
            channel.invokeMethod(
                "runOnce",
                mapOf("budgetMilliseconds" to BUDGET_MILLIS),
                object : MethodChannel.Result {
                    override fun success(result: Any?) {
                        engine.destroy()
                        if (continuation.isActive) continuation.resume(true)
                    }

                    override fun error(code: String, message: String?, details: Any?) {
                        engine.destroy()
                        if (continuation.isActive) continuation.resume(false)
                    }

                    override fun notImplemented() {
                        engine.destroy()
                        if (continuation.isActive) continuation.resume(false)
                    }
                },
            )
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
