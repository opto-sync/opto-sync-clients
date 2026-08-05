import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:opto_sync_client/connectivity.dart';

export 'package:opto_sync_client/connectivity.dart';

/// Flutter bridge for the native Android/iOS connectivity watchers.
///
/// This class exposes streams and callbacks only. It never imports Material,
/// Cupertino, or any other UI framework; applications decide how to surface a
/// save or connectivity event.
final class OptoSyncFlutterConnectivity
    implements OptoSyncConnectivityWatcher {
  OptoSyncFlutterConnectivity({
    this.probeUrl,
    this.probeTimeout = const Duration(seconds: 4),
    ManualOptoSyncConnectivityWatcher? watcher,
  })  : _watcher = watcher ?? ManualOptoSyncConnectivityWatcher(),
        _ownsWatcher = watcher == null {
    final url = probeUrl;
    if (url != null) {
      if (url.scheme != 'https' && url.scheme != 'http') {
        throw ArgumentError.value(url, 'probeUrl', 'must use HTTP or HTTPS');
      }
      if (url.userInfo.isNotEmpty) {
        throw ArgumentError.value(
          url,
          'probeUrl',
          'must not contain embedded credentials',
        );
      }
    }
    if (probeTimeout <= Duration.zero) {
      throw ArgumentError.value(
        probeTimeout,
        'probeTimeout',
        'must be greater than zero',
      );
    }
  }

  static const EventChannel _defaultEvents = EventChannel(
    'dev.optosync.background/connectivity',
  );
  static const MethodChannel _defaultMethods = MethodChannel(
    'dev.optosync.background/methods',
  );

  @visibleForTesting
  static EventChannel events = _defaultEvents;

  @visibleForTesting
  static MethodChannel methods = _defaultMethods;

  final Uri? probeUrl;
  final Duration probeTimeout;
  final ManualOptoSyncConnectivityWatcher _watcher;
  final bool _ownsWatcher;
  StreamSubscription<Object?>? _nativeSubscription;
  bool _started = false;
  bool _disposed = false;

  @override
  OptoSyncConnectivitySnapshot get snapshot => _watcher.snapshot;

  @override
  Stream<OptoSyncConnectivitySnapshot> get changes => _watcher.changes;

  @override
  Stream<OptoSyncConnectivitySnapshot> snapshots({bool emitCurrent = true}) =>
      _watcher.snapshots(emitCurrent: emitCurrent);

  @override
  void start() {
    if (_started || _disposed) return;
    _started = true;
    _nativeSubscription = events.receiveBroadcastStream().listen(
      _acceptNativeSnapshot,
      onError: (_) {
        // Missing plugins and transient channel failures leave the current
        // state intact. Callers can still publish through the manual watcher.
      },
    );
    unawaited(_configureAndRefresh());
  }

  @override
  Future<void> stop() async {
    if (!_started) return;
    _started = false;
    await _nativeSubscription?.cancel();
    _nativeSubscription = null;
  }

  @override
  void setMode(OptoSyncConnectivityMode mode) {
    if (_disposed) return;
    _watcher.setMode(mode);
    unawaited(
      methods
          .invokeMethod<void>('setConnectivityOffline', <String, Object?>{
            'enabled': mode == OptoSyncConnectivityMode.offline,
          })
          .catchError((Object _) {}),
    );
  }

  void setTotalOffline(bool enabled) => setMode(
        enabled
            ? OptoSyncConnectivityMode.offline
            : OptoSyncConnectivityMode.automatic,
      );

  @override
  Future<OptoSyncConnectivitySnapshot> refresh() async {
    if (_disposed || snapshot.mode == OptoSyncConnectivityMode.offline) {
      return snapshot;
    }
    try {
      final value = await methods.invokeMapMethod<String, Object?>(
        'refreshConnectivity',
      );
      if (value != null) _acceptNativeSnapshot(value);
    } on MissingPluginException {
      // Flutter web/desktop hosts can publish through a platform adapter.
    } on PlatformException {
      // A reachability failure is a hint, not a durable-save failure.
    }
    return snapshot;
  }

  /// Native-independent bridge for Flutter web/desktop or custom plugins.
  void publish(
    OptoSyncConnectivityState state, {
    bool verified = false,
  }) {
    _watcher.publish(
      verified ? OptoSyncConnectivityState.internet : state,
      source: verified
          ? OptoSyncConnectivitySource.probe
          : OptoSyncConnectivitySource.platform,
    );
  }

  Future<void> dispose() async {
    if (_disposed) return;
    _disposed = true;
    await stop();
    if (_ownsWatcher) await _watcher.close();
  }

  Future<void> _configureAndRefresh() async {
    try {
      await methods.invokeMethod<void>('configureConnectivity', {
        'probeUrl': probeUrl?.toString(),
        'probeTimeoutMilliseconds': probeTimeout.inMilliseconds,
      });
    } on MissingPluginException {
      return;
    } on PlatformException {
      // The stream may still provide link/offline state without active probes.
    }
    await refresh();
  }

  void _acceptNativeSnapshot(Object? raw) {
    if (_disposed || raw is! Map) return;
    final state = switch (raw['state']) {
      'offline' => OptoSyncConnectivityState.offline,
      'link' => OptoSyncConnectivityState.link,
      'internet' => OptoSyncConnectivityState.internet,
      _ => OptoSyncConnectivityState.unknown,
    };
    final source = switch (raw['source']) {
      'probe' => OptoSyncConnectivitySource.probe,
      'forced-offline' => OptoSyncConnectivitySource.forcedOffline,
      _ => OptoSyncConnectivitySource.platform,
    };
    final verifiedMillis = raw['verifiedAt'];
    _watcher.publish(
      state,
      source: source,
      verifiedAt: verifiedMillis is num
          ? DateTime.fromMillisecondsSinceEpoch(verifiedMillis.toInt())
          : null,
    );
  }
}
