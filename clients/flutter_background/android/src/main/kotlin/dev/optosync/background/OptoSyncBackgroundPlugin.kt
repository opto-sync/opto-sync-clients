package dev.optosync.background

import android.content.Context
import android.os.Handler
import android.os.Looper
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
import io.flutter.plugin.common.EventChannel
import io.flutter.plugin.common.MethodCall
import io.flutter.plugin.common.MethodChannel
import java.util.concurrent.TimeUnit

/**
 * Method/event-channel surface for background drains and connectivity state.
 * No UI classes are imported: Flutter, Kotlin, and Java hosts consume data and
 * decide independently how to present it.
 */
class OptoSyncBackgroundPlugin :
    FlutterPlugin,
    MethodChannel.MethodCallHandler,
    EventChannel.StreamHandler {
    companion object {
        const val PERIODIC_WORK_NAME = "opto-sync-periodic"
        const val EXPEDITED_WORK_NAME = "opto-sync-expedited"
        const val PREFS = "dev.optosync.background"
        const val KEY_CALLBACK_HANDLE = "callbackHandle"
        const val KEY_DISPATCHER_HANDLE = "dispatcherHandle"
        const val KEY_TOTAL_OFFLINE = "totalOffline"
        const val KEY_PERIODIC_REGISTERED = "periodicRegistered"
        const val KEY_PERIODIC_FREQUENCY_SECONDS = "periodicFrequencySeconds"
        const val KEY_PERIODIC_REQUIRES_NETWORK = "periodicRequiresNetwork"

        @JvmStatic
        fun storedCallbackHandle(context: Context): Long =
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .getLong(KEY_CALLBACK_HANDLE, 0L)

        @JvmStatic
        fun storedDispatcherHandle(context: Context): Long =
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .getLong(KEY_DISPATCHER_HANDLE, 0L)

        @JvmStatic
        fun isTotalOffline(context: Context): Boolean =
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .getBoolean(KEY_TOTAL_OFFLINE, false)
    }

    private lateinit var channel: MethodChannel
    private lateinit var eventChannel: EventChannel
    private lateinit var context: Context
    private lateinit var connectivity: OptoSyncConnectivityWatcher
    private val mainHandler = Handler(Looper.getMainLooper())
    private var eventSink: EventChannel.EventSink? = null
    private var connectivitySubscription: AutoCloseable? = null

    override fun onAttachedToEngine(binding: FlutterPlugin.FlutterPluginBinding) {
        context = binding.applicationContext
        channel = MethodChannel(binding.binaryMessenger, "dev.optosync.background/methods")
        channel.setMethodCallHandler(this)
        eventChannel = EventChannel(
            binding.binaryMessenger,
            "dev.optosync.background/connectivity",
        )
        eventChannel.setStreamHandler(this)
        connectivity = OptoSyncConnectivityWatcher(context)
        connectivity.setTotalOffline(isTotalOffline(context))
        connectivity.start()
    }

    override fun onDetachedFromEngine(binding: FlutterPlugin.FlutterPluginBinding) {
        connectivitySubscription?.close()
        connectivitySubscription = null
        eventSink = null
        connectivity.stop()
        eventChannel.setStreamHandler(null)
        channel.setMethodCallHandler(null)
    }

    override fun onListen(arguments: Any?, events: EventChannel.EventSink) {
        connectivitySubscription?.close()
        eventSink = events
        connectivitySubscription = connectivity.addListener(
            OptoSyncConnectivityListener { current, _ ->
                mainHandler.post {
                    if (eventSink === events) events.success(current.toMap())
                }
            },
            emitCurrent = true,
        )
    }

    override fun onCancel(arguments: Any?) {
        connectivitySubscription?.close()
        connectivitySubscription = null
        eventSink = null
    }

    override fun onMethodCall(call: MethodCall, result: MethodChannel.Result) {
        when (call.method) {
            "configureConnectivity" -> {
                // Android's NET_CAPABILITY_VALIDATED already performs an OS
                // reachability check. The optional app probe is used by iOS.
                result.success(connectivity.refresh().toMap())
            }
            "setConnectivityOffline" -> {
                val enabled = call.argument<Boolean>("enabled")
                if (enabled == null) {
                    result.error("BAD_ARGS", "enabled is required", null)
                    return
                }
                context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                    .edit()
                    .putBoolean(KEY_TOTAL_OFFLINE, enabled)
                    .apply()
                connectivity.setTotalOffline(enabled)
                if (enabled) {
                    WorkManager.getInstance(context).cancelUniqueWork(EXPEDITED_WORK_NAME)
                } else {
                    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                    if (prefs.getBoolean(KEY_PERIODIC_REGISTERED, false)) {
                        enqueuePeriodic(
                            prefs.getLong(KEY_PERIODIC_FREQUENCY_SECONDS, 3600L),
                            prefs.getBoolean(KEY_PERIODIC_REQUIRES_NETWORK, true),
                        )
                    }
                }
                result.success(connectivity.snapshot().toMap())
            }
            "refreshConnectivity" -> {
                result.success(connectivity.refresh().toMap())
            }
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
                        .coerceAtLeast(TimeUnit.MINUTES.toSeconds(15))
                val requiresNetwork = call.argument<Boolean>("requiresNetwork") ?: true
                context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                    .edit()
                    .putBoolean(KEY_PERIODIC_REGISTERED, true)
                    .putLong(KEY_PERIODIC_FREQUENCY_SECONDS, frequencySeconds)
                    .putBoolean(KEY_PERIODIC_REQUIRES_NETWORK, requiresNetwork)
                    .apply()
                if (!isTotalOffline(context)) {
                    enqueuePeriodic(frequencySeconds, requiresNetwork)
                }
                result.success(null)
            }
            "scheduleExpedited" -> {
                if (isTotalOffline(context)) {
                    result.success(null)
                    return
                }
                val request = OneTimeWorkRequestBuilder<OptoSyncWorker>()
                    .setConstraints(constraints(requiresNetwork = true))
                    .setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
                    .setBackoffCriteria(
                        BackoffPolicy.EXPONENTIAL,
                        WorkRequest.MIN_BACKOFF_MILLIS,
                        TimeUnit.MILLISECONDS,
                    )
                    .build()
                WorkManager.getInstance(context).enqueueUniqueWork(
                    EXPEDITED_WORK_NAME,
                    ExistingWorkPolicy.KEEP,
                    request,
                )
                result.success(null)
            }
            "cancelAll" -> {
                context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                    .edit()
                    .putBoolean(KEY_PERIODIC_REGISTERED, false)
                    .apply()
                WorkManager.getInstance(context).cancelUniqueWork(PERIODIC_WORK_NAME)
                WorkManager.getInstance(context).cancelUniqueWork(EXPEDITED_WORK_NAME)
                result.success(null)
            }
            else -> result.notImplemented()
        }
    }

    private fun enqueuePeriodic(frequencySeconds: Long, requiresNetwork: Boolean) {
        val request = PeriodicWorkRequestBuilder<OptoSyncWorker>(
            frequencySeconds.coerceAtLeast(TimeUnit.MINUTES.toSeconds(15)),
            TimeUnit.SECONDS,
        )
            .setConstraints(constraints(requiresNetwork))
            .setBackoffCriteria(
                BackoffPolicy.EXPONENTIAL,
                WorkRequest.MIN_BACKOFF_MILLIS,
                TimeUnit.MILLISECONDS,
            )
            .build()
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(
            PERIODIC_WORK_NAME,
            ExistingPeriodicWorkPolicy.UPDATE,
            request,
        )
    }

    private fun constraints(requiresNetwork: Boolean): Constraints =
        Constraints.Builder()
            .setRequiredNetworkType(
                if (requiresNetwork) NetworkType.CONNECTED else NetworkType.NOT_REQUIRED,
            )
            .build()
}
