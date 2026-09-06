/// Synchronous state management without Flutter, I/O, or a second sync queue.
library;

/// Reducers, states and selected values must be immutable. Effects live outside
/// the reducer and enter the store through a [StateEffect].
final class StateStore<S, A> {
  StateStore(
    S initial,
    S Function(S state, A action) reduce, {
    void Function(Object error, StackTrace stackTrace)? onObserverError,
  }) : _state = initial,
       _reduce = reduce,
       _onObserverError = onObserverError;

  S _state;
  final S Function(S, A) _reduce;
  final void Function(Object, StackTrace)? _onObserverError;
  var _revision = 0;
  var _busy = false;
  var _disposed = false;
  final _listeners = <void Function()>{};
  final _effects = <String, Object>{};

  S get state => _state;
  int get revision => _revision;
  bool get disposed => _disposed;

  void _check() {
    if (_disposed) throw StateError('StateStore is disposed');
    if (_busy) {
      throw StateError('StateStore does not allow reentrant transitions');
    }
  }

  void _notify() {
    for (final listener in List<void Function()>.of(_listeners)) {
      if (!_listeners.contains(listener)) continue;
      try {
        listener();
      } catch (error, stackTrace) {
        try {
          _onObserverError?.call(error, stackTrace);
        } catch (_) {
          // A rendering/diagnostic failure cannot fail a committed dispatch.
        }
      }
    }
  }

  void dispatch(A action) {
    _check();
    _busy = true;
    try {
      final next = _reduce(_state, action);
      if (next is Future) {
        throw StateError('StateStore reducers must be synchronous');
      }
      _state = next;
      _revision += 1;
      _notify();
    } finally {
      _busy = false;
    }
  }

  /// Clear user state and fence outstanding results on session change/logout.
  void reset(S initial) {
    _check();
    _busy = true;
    try {
      _effects.clear();
      _state = initial;
      _revision += 1;
      _notify();
    } finally {
      _busy = false;
    }
  }

  /// Replay synchronously, then deliver only distinct selected values.
  /// The returned cancellation function is idempotent.
  void Function() select<T>(
    T Function(S state) selector,
    void Function(T value) listener, {
    bool Function(T left, T right)? same,
  }) {
    _check();
    _busy = true;
    try {
      final equals = same ?? (T left, T right) => left == right;
      var previous = selector(_state);
      void notify() {
        final next = selector(_state);
        if (equals(previous, next)) return;
        previous = next;
        listener(next);
      }

      listener(previous);
      _listeners.add(notify);
      return () => _listeners.remove(notify);
    } finally {
      _busy = false;
    }
  }

  /// Latest result wins per key. Does not cancel already-started durable writes.
  StateEffect<A> beginEffect(String key) {
    _check();
    final token = Object();
    _effects[key] = token;
    bool isCurrent() => !_disposed && identical(_effects[key], token);
    return StateEffect<A>._(
      isCurrent,
      (action) {
        if (!isCurrent()) return false;
        dispatch(action);
        return true;
      },
      () {
        if (isCurrent()) _effects.remove(key);
      },
    );
  }

  /// Hydrate a complete localView after pending mutations have been replayed.
  Future<bool> projectLocalView<T>(
    String key,
    Future<T> Function() read,
    A Function(T value) action,
  ) async {
    final effect = beginEffect(key);
    try {
      final value = await read();
      return effect.isCurrent && effect.dispatch(action(value));
    } finally {
      effect.close();
    }
  }

  void dispose() {
    if (_disposed) return;
    _check();
    _disposed = true;
    _effects.clear();
    _listeners.clear();
  }
}

final class StateEffect<A> {
  StateEffect._(this._isCurrent, this.dispatch, this.close);

  final bool Function() _isCurrent;
  final bool Function(A action) dispatch;
  final void Function() close;
  bool get isCurrent => _isCurrent();
}
