package dev.optosync.background;

import android.content.Context;

import androidx.annotation.NonNull;
import androidx.work.BackoffPolicy;
import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.ExistingWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.OneTimeWorkRequest;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import java.time.Duration;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

public final class OptoSyncJavaWorker extends Worker {
    public enum Outcome {
        SUCCESS,
        RETRY,
        PERMANENT_FAILURE
    }

    public interface Delegate {
        /**
         * Reopen the session-scoped SQLite database and run bounded sync work.
         * This method runs off the main thread and must honor worker stoppage.
         */
        Outcome run() throws Exception;
    }

    public interface Factory {
        Delegate create(Context applicationContext);
    }

    private static final AtomicReference<Factory> FACTORY = new AtomicReference<>();
    public static final String DEFAULT_UNIQUE_WORK = "opto-sync.flush.java";
    public static final String DEFAULT_PERIODIC_WORK = "opto-sync.periodic.java";

    public OptoSyncJavaWorker(
            @NonNull Context appContext,
            @NonNull WorkerParameters parameters
    ) {
        super(appContext, parameters);
    }

    /**
     * Call from Application.onCreate(); that method also runs on a cold
     * WorkManager process launch.
     */
    public static void install(@NonNull Factory factory) {
        FACTORY.set(factory);
    }

    @NonNull
    @Override
    public Result doWork() {
        Factory factory = FACTORY.get();
        if (factory == null) {
            return Result.failure();
        }
        try {
            Outcome outcome = factory.create(getApplicationContext()).run();
            switch (outcome) {
                case SUCCESS:
                    return Result.success();
                case PERMANENT_FAILURE:
                    return Result.failure();
                case RETRY:
                default:
                    return Result.retry();
            }
        } catch (Exception ignored) {
            // No credential/payload is logged. The durable idempotent queue is
            // safe to retry after process, SQLite, or network interruption.
            return Result.retry();
        }
    }

    public static void scheduleOneOff(@NonNull Context context) {
        scheduleOneOff(context, DEFAULT_UNIQUE_WORK);
    }

    public static void scheduleOneOff(
            @NonNull Context context,
            @NonNull String uniqueName
    ) {
        Constraints constraints = new Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .build();
        OneTimeWorkRequest request =
                new OneTimeWorkRequest.Builder(OptoSyncJavaWorker.class)
                        .setConstraints(constraints)
                        .setBackoffCriteria(
                                BackoffPolicy.EXPONENTIAL,
                                10,
                                TimeUnit.SECONDS
                        )
                        .addTag(DEFAULT_UNIQUE_WORK)
                        .build();
        WorkManager.getInstance(context).enqueueUniqueWork(
                uniqueName,
                ExistingWorkPolicy.APPEND_OR_REPLACE,
                request
        );
    }

    public static void schedulePeriodic(
            @NonNull Context context,
            @NonNull Duration interval,
            boolean requiresCharging
    ) {
        if (interval.compareTo(Duration.ofMinutes(15)) < 0) {
            throw new IllegalArgumentException(
                    "Android periodic work has a 15 minute minimum"
            );
        }
        Constraints constraints = new Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .setRequiresCharging(requiresCharging)
                .build();
        PeriodicWorkRequest request =
                new PeriodicWorkRequest.Builder(
                        OptoSyncJavaWorker.class,
                        interval.toMinutes(),
                        TimeUnit.MINUTES
                )
                        .setConstraints(constraints)
                        .setBackoffCriteria(
                                BackoffPolicy.EXPONENTIAL,
                                10,
                                TimeUnit.SECONDS
                        )
                        .addTag(DEFAULT_PERIODIC_WORK)
                        .build();
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                DEFAULT_PERIODIC_WORK,
                ExistingPeriodicWorkPolicy.UPDATE,
                request
        );
    }
}
