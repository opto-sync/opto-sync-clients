package dev.optosync.background

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.os.Build
import java.util.concurrent.CopyOnWriteArraySet
import java.util.concurrent.atomic.AtomicBoolean

/** Link and verified-internet state, intentionally independent of any UI. */
enum class OptoSyncConnectivityState(val wireName: String) {
    UNKNOWN("unknown"),
    OFFLINE("offline"),
    LINK("link"),
    INTERNET("internet"),
}

data class OptoSyncConnectivitySnapshot(
    val state: OptoSyncConnectivityState,
    val totalOffline: Boolean,
    val source: String,
    val changedAt: Long,
    val verifiedAt: Long? = null,
) {
    val hasVerifiedInternet: Boolean
        get() = !totalOffline && state == OptoSyncConnectivityState.INTERNET

    fun toMap(): Map<String, Any?> = mapOf(
        "state" to state.wireName,
        "mode" to if (totalOffline) "offline" else "automatic",
        "source" to source,
        "changedAt" to changedAt,
        "verifiedAt" to verifiedAt,
    )
}

fun interface OptoSyncConnectivityListener {
    fun onConnectivityChanged(
        current: OptoSyncConnectivitySnapshot,
        previous: OptoSyncConnectivitySnapshot,
    )
}

/**
 * Android ConnectivityManager adapter.
 *
 * A transport with NET_CAPABILITY_INTERNET is only `link`. It becomes
 * `internet` when Android also reports NET_CAPABILITY_VALIDATED, which means
 * the system's own end-to-end validation succeeded. The explicit total-offline
 * override remains authoritative and suppresses all exposed online state.
 */
class OptoSyncConnectivityWatcher(context: Context) {
    private val connectivityManager =
        context.applicationContext.getSystemService(Context.CONNECTIVITY_SERVICE)
            as ConnectivityManager
    private val listeners = CopyOnWriteArraySet<OptoSyncConnectivityListener>()
    private val started = AtomicBoolean(false)
    private val lock = Any()

    @Volatile
    private var current = OptoSyncConnectivitySnapshot(
        state = OptoSyncConnectivityState.UNKNOWN,
        totalOffline = false,
        source = "initial",
        changedAt = System.currentTimeMillis(),
    )

    private var automatic = current

    private val callback = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) {
            refresh()
        }

        override fun onCapabilitiesChanged(
            network: Network,
            networkCapabilities: NetworkCapabilities,
        ) = publishAutomatic(snapshotFromCapabilities(networkCapabilities))

        override fun onLost(network: Network) {
            refresh()
        }

        override fun onUnavailable() = publishAutomatic(
            OptoSyncConnectivitySnapshot(
                state = OptoSyncConnectivityState.OFFLINE,
                totalOffline = false,
                source = "platform",
                changedAt = System.currentTimeMillis(),
            ),
        )
    }

    fun snapshot(): OptoSyncConnectivitySnapshot = current

    @JvmOverloads
    fun addListener(
        listener: OptoSyncConnectivityListener,
        emitCurrent: Boolean = true,
    ): AutoCloseable {
        listeners.add(listener)
        if (emitCurrent) runCatching { listener.onConnectivityChanged(current, current) }
        return AutoCloseable { listeners.remove(listener) }
    }

    fun start() {
        if (!started.compareAndSet(false, true)) return
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                connectivityManager.registerDefaultNetworkCallback(callback)
            } else {
                val request = NetworkRequest.Builder()
                    .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                    .build()
                connectivityManager.registerNetworkCallback(request, callback)
            }
        } catch (_: RuntimeException) {
            // Missing permissions or vendor failures leave refresh() as a safe
            // best-effort snapshot instead of crashing application startup.
        }
        refresh()
    }

    fun stop() {
        if (!started.compareAndSet(true, false)) return
        runCatching { connectivityManager.unregisterNetworkCallback(callback) }
    }

    fun setTotalOffline(enabled: Boolean) {
        val previous = current
        if (enabled == previous.totalOffline) return
        if (enabled) {
            transition(
                OptoSyncConnectivitySnapshot(
                    state = OptoSyncConnectivityState.OFFLINE,
                    totalOffline = true,
                    source = "forced-offline",
                    changedAt = System.currentTimeMillis(),
                ),
            )
        } else {
            transition(
                automatic.copy(
                    totalOffline = false,
                    changedAt = System.currentTimeMillis(),
                ),
            )
            refresh()
        }
    }

    fun refresh(): OptoSyncConnectivitySnapshot {
        val observed = try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                val network = connectivityManager.activeNetwork
                val capabilities = network?.let(connectivityManager::getNetworkCapabilities)
                if (capabilities == null) offlineSnapshot() else snapshotFromCapabilities(capabilities)
            } else {
                @Suppress("DEPRECATION")
                if (connectivityManager.activeNetworkInfo?.isConnected == true) {
                    OptoSyncConnectivitySnapshot(
                        state = OptoSyncConnectivityState.LINK,
                        totalOffline = false,
                        source = "platform",
                        changedAt = System.currentTimeMillis(),
                    )
                } else {
                    offlineSnapshot()
                }
            }
        } catch (_: RuntimeException) {
            OptoSyncConnectivitySnapshot(
                state = OptoSyncConnectivityState.UNKNOWN,
                totalOffline = false,
                source = "platform",
                changedAt = System.currentTimeMillis(),
            )
        }
        publishAutomatic(observed)
        return current
    }

    private fun snapshotFromCapabilities(
        capabilities: NetworkCapabilities,
    ): OptoSyncConnectivitySnapshot {
        val now = System.currentTimeMillis()
        val hasInternetCapability = capabilities.hasCapability(
            NetworkCapabilities.NET_CAPABILITY_INTERNET,
        )
        val validated = Build.VERSION.SDK_INT >= Build.VERSION_CODES.M &&
            capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
        val state = when {
            validated -> OptoSyncConnectivityState.INTERNET
            hasInternetCapability -> OptoSyncConnectivityState.LINK
            else -> OptoSyncConnectivityState.LINK
        }
        return OptoSyncConnectivitySnapshot(
            state = state,
            totalOffline = false,
            source = "platform",
            changedAt = now,
            verifiedAt = if (validated) now else null,
        )
    }

    private fun offlineSnapshot() = OptoSyncConnectivitySnapshot(
        state = OptoSyncConnectivityState.OFFLINE,
        totalOffline = false,
        source = "platform",
        changedAt = System.currentTimeMillis(),
    )

    private fun publishAutomatic(next: OptoSyncConnectivitySnapshot) {
        synchronized(lock) {
            automatic = next.copy(
                totalOffline = false,
                changedAt = if (next.state == automatic.state) {
                    automatic.changedAt
                } else {
                    next.changedAt
                },
            )
        }
        if (!current.totalOffline) transition(automatic)
    }

    private fun transition(candidate: OptoSyncConnectivitySnapshot) {
        val previous: OptoSyncConnectivitySnapshot
        val next: OptoSyncConnectivitySnapshot
        synchronized(lock) {
            previous = current
            val changed = previous.state != candidate.state ||
                previous.totalOffline != candidate.totalOffline
            next = candidate.copy(
                changedAt = if (changed) candidate.changedAt else previous.changedAt,
            )
            current = next
            if (!changed) return
        }
        listeners.forEach { listener ->
            runCatching { listener.onConnectivityChanged(next, previous) }
        }
    }
}
