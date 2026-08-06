package dev.optosync.background

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import java.time.Duration
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.CancellationException

enum class OptoSyncWorkerOutcome {
    SUCCESS,
    RETRY,
    PERMANENT_FAILURE,
}

fun interface OptoSyncWorkerDelegate {
    /**
     * Reopen the session-scoped SQLite database, resolve a fresh access token,
     * and run bounded pull/push/pull cycles. Never retain an Activity here.
     */
    suspend fun run(): OptoSyncWorkerOutcome
}

/**
 * Install from Application.onCreate(), which Android also invokes when a
 * WorkManager cold start creates the application process.
 */
object OptoSyncWorkerRegistry {
    @Volatile
    var factory: ((Context) -> OptoSyncWorkerDelegate)? = null
}

class OptoSyncCoroutineWorker(
    appContext: Context,
    parameters: WorkerParameters,
) : CoroutineWorker(appContext, parameters) {
    override suspend fun doWork(): Result {
        val delegate = OptoSyncWorkerRegistry.factory?.invoke(applicationContext)
            ?: return Result.failure()
        return try {
            when (delegate.run()) {
                OptoSyncWorkerOutcome.SUCCESS -> Result.success()
                OptoSyncWorkerOutcome.RETRY -> Result.retry()
                OptoSyncWorkerOutcome.PERMANENT_FAILURE -> Result.failure()
            }
        } catch (cancelled: CancellationException) {
            // WorkManager uses coroutine cancellation for explicit stops and
            // OS preemption. Propagate it so the worker halts immediately.
            throw cancelled
        } catch (_: Throwable) {
            // The protocol queue is durable and requests are idempotent. An
            // unexpected process/network failure is safe to retry; delegates
            // return PERMANENT_FAILURE for explicit auth/schema rejection.
            Result.retry()
        }
    }

    companion object {
        const val DEFAULT_UNIQUE_WORK = "opto-sync.flush"
        const val DEFAULT_PERIODIC_WORK = "opto-sync.periodic"

        @JvmStatic
        fun scheduleOneOff(
            context: Context,
            uniqueName: String = DEFAULT_UNIQUE_WORK,
        ) {
            val request = OneTimeWorkRequestBuilder<OptoSyncCoroutineWorker>()
                .setConstraints(
                    Constraints.Builder()
                        .setRequiredNetworkType(NetworkType.CONNECTED)
                        .build(),
                )
                .setBackoffCriteria(
                    BackoffPolicy.EXPONENTIAL,
                    10,
                    TimeUnit.SECONDS,
                )
                .addTag(DEFAULT_UNIQUE_WORK)
                .build()
            WorkManager.getInstance(context).enqueueUniqueWork(
                uniqueName,
                ExistingWorkPolicy.APPEND_OR_REPLACE,
                request,
            )
        }

        @JvmStatic
        fun schedulePeriodic(
            context: Context,
            interval: Duration = Duration.ofMinutes(15),
            uniqueName: String = DEFAULT_PERIODIC_WORK,
            requiresCharging: Boolean = false,
        ) {
            require(interval >= Duration.ofMinutes(15)) {
                "Android periodic work has a 15 minute minimum"
            }
            val request =
                PeriodicWorkRequestBuilder<OptoSyncCoroutineWorker>(interval)
                    .setConstraints(
                        Constraints.Builder()
                            .setRequiredNetworkType(NetworkType.CONNECTED)
                            .setRequiresCharging(requiresCharging)
                            .build(),
                    )
                    .setBackoffCriteria(
                        BackoffPolicy.EXPONENTIAL,
                        10,
                        TimeUnit.SECONDS,
                    )
                    .addTag(DEFAULT_PERIODIC_WORK)
                    .build()
            WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                uniqueName,
                ExistingPeriodicWorkPolicy.UPDATE,
                request,
            )
        }
    }
}
