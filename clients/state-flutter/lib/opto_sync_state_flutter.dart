library;

import 'package:flutter/foundation.dart';
import 'package:opto_sync_reactive/state_store.dart';

export 'package:opto_sync_reactive/state_store.dart';

/// Read-only selection for ValueListenableBuilder, Provider, or a BLoC owner.
/// Create once in initState/composition, and dispose with that owner. The store
/// itself can outlive a widget and is disposed by its session/application owner.
final class StoreListenable<S, A, T> implements ValueListenable<T> {
  StoreListenable(
    StateStore<S, A> store,
    T Function(S state) selector, {
    bool Function(T left, T right)? same,
  }) : _notifier = _SelectionNotifier<T>(selector(store.state)) {
    _cancel = store.select(selector, _notifier.accept, same: same);
  }

  final _SelectionNotifier<T> _notifier;
  late final void Function() _cancel;
  var _disposed = false;

  @override
  T get value => _notifier.value;
  @override
  void addListener(VoidCallback listener) => _notifier.addListener(listener);
  @override
  void removeListener(VoidCallback listener) =>
      _notifier.removeListener(listener);

  void dispose() {
    if (_disposed) return;
    _disposed = true;
    _cancel();
    _notifier.dispose();
  }
}

// Equality belongs to the store selector. ValueNotifier would apply a second
// equality rule and could suppress updates that the caller explicitly selected.
final class _SelectionNotifier<T> extends ChangeNotifier {
  _SelectionNotifier(this.value);
  T value;
  void accept(T next) {
    value = next;
    notifyListeners();
  }
}
