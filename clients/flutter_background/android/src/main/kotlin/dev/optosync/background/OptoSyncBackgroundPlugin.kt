package dev.optosync.background

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.OutOfQuotaPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkRequest
import io.flutter.embedding.engine.plugins.FlutterPlugin
import io.flutter.plugin.common.MethodCall
import io.flutter.plugin.common.MethodChannel
import java.util.concurrent.TimeUnit

/**
 * Method-channel surface for scheduling opto-sync background drains with
 * WorkManager. The drain itself runs in [OptoSyncWorker] (Kotlin) — Java-only
 * host apps can schedule [OptoSyncWorkerJava] instead; both execute the same
 * registered Dart callback in a background FlutterEngine.
 */
class OptoSyncBackgroundPlugin : FlutterPlugin, MethodChannel.MethodCallHandler {
    companion object {
        const val PERIODIC_WORK_NAME = "opto-sync-periodic"
        const val EXPEDITED_WORK_NAME = "opto-sync-expedited"
        const val PREFS = "dev.optosync.background"
        const val KEY_CALLBACK_HANDLE = "callbackHandle"
        const val KEY_DISPATCHER_HANDLE = "dispatcherHandle"

        @JvmStatic
        fun storedCallbackHandle(context: Context): Long =
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .getLong(KEY_CALLBACK_HANDLE, 0L)

        @JvmStatic
        fun storedDispatcherHandle(context: Context): Long =
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .getLong(KEY_DISPATCHER_HANDLE, 0L)
    }

    private lateinit var channel: MethodChannel
    private lateinit var context: Context

    override fun onAttachedToEngine(binding: FlutterPlugin.FlutterPluginBinding) {
        context = binding.applicationContext
        channel = MethodChannel(binding.binaryMessenger, "dev.optosync.background/methods")
        channel.setMethodCallHandler(this)
    }

    override fun onDetachedFromEngine(binding: FlutterPlugin.FlutterPluginBinding) {
        channel.setMethodCallHandler(null)
    }

    override fun onMethodCall(call: MethodCall, result: MethodChannel.Result) {
        when (call.method) {
            "initialize" -> {
                val handle = call.argument<Number>("callbackHandle")?.toLong()
                val dispatcher = call.argument<Number>("dispatcherHandle")?.toLong()
                if (handle == null || handle == 0L || dispatcher == null || dispatcher == 0L) {
                    result.error("BAD_ARGS", "callbackHandle and dispatcherHandle are required", null)
                    return
                }
                context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                    .edit()
                    .putLong(KEY_CALLBACK_HANDLE, handle)
                    .putLong(KEY_DISPATCHER_HANDLE, dispatcher)
                    .apply()
                result.success(null)
            }
            "registerPeriodic" -> {
                val frequencySeconds =
                    (call.argument<Number>("frequencySeconds")?.toLong() ?: 3600L)
                        // WorkManager enforces a 15-minute floor for periodic work.
                        .coerceAtLeast(TimeUnit.MINUTES.toSeconds(15))
                val requiresNetwork = call.argument<Boolean>("requiresNetwork") ?: true
                val request = PeriodicWorkRequestBuilder<OptoSyncWorker>(
                    frequencySeconds, TimeUnit.SECONDS,
                )
                    .setConstraints(constraints(requiresNetwork))
                    .setBackoffCriteria(
                        BackoffPolicy.EXPONENTIAL,
                        WorkManager.MIN_BACKOFF_MILLIS,
                        TimeUnit.MILLISECONDS,
                    )
                    .build()
                WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                    PERIODIC_WORK_NAME,
                    ExistingPeriodicWorkPolicy.UPDATE,
                    request,
                )
                result.success(null)
            }
            "scheduleExpedited" -> {
                val request = OneTimeWorkRequestBuilder<OptoSyncWorker>()
                    .setConstraints(constraints(requiresNetwork = true))
                    // Falls back to ordinary work when the expedited quota is spent.
                    .setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
                    .setBackoffCriteria(
                        BackoffPolicy.EXPONENTIAL,
                        WorkManager.MIN_BACKOFF_MILLIS,
                        TimeUnit.MILLISECONDS,
                    )
                    .build()
                WorkManager.getInstance(context).enqueueUniqueWork(
                    EXPEDITED_WORK_NAME,
                    // A drain already queued to run covers this commit too.
                    ExistingWorkPolicy.KEEP,
                    request,
                )
                result.success(null)
            }
            "cancelAll" -> {
                WorkManager.getInstance(context).cancelUniqueWork(PERIODIC_WORK_NAME)
                WorkManager.getInstance(context).cancelUniqueWork(EXPEDITED_WORK_NAME)
                result.success(null)
            }
            else -> result.notImplemented()
        }
    }

    private fun constraints(requiresNetwork: Boolean): Constraints =
        Constraints.Builder()
            .setRequiredNetworkType(
                if (requiresNetwork) NetworkType.CONNECTED else NetworkType.NOT_REQUIRED,
            )
            .build()
}
