package dev.optosync.background;

import android.content.Context;

/** Plain-Java facade for hosts that do not use Kotlin. */
public final class OptoSyncConnectivityWatcherJava implements AutoCloseable {
    public interface Listener {
        void onConnectivityChanged(
            OptoSyncConnectivitySnapshot current,
            OptoSyncConnectivitySnapshot previous
        );
    }

    private final OptoSyncConnectivityWatcher delegate;

    public OptoSyncConnectivityWatcherJava(Context context) {
        delegate = new OptoSyncConnectivityWatcher(context);
    }

    public void start() {
        delegate.start();
    }

    public void stop() {
        delegate.stop();
    }

    public void setTotalOffline(boolean enabled) {
        delegate.setTotalOffline(enabled);
    }

    public OptoSyncConnectivitySnapshot refresh() {
        return delegate.refresh();
    }

    public OptoSyncConnectivitySnapshot snapshot() {
        return delegate.snapshot();
    }

    public AutoCloseable addListener(Listener listener, boolean emitCurrent) {
        return delegate.addListener(
            (current, previous) -> listener.onConnectivityChanged(current, previous),
            emitCurrent
        );
    }

    @Override
    public void close() {
        stop();
    }
}
