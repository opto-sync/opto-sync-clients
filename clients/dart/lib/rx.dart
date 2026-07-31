/// RxDart surface: reactive reads and optimism-level writes.
///
/// Import with a prefix so wrapper packages (fiducia-sync, daedalus-sync, …)
/// keep a clash-free namespace:
///
/// ```dart
/// import 'package:opto_sync_client/rx.dart' as rx;
/// rx.watchLocalView(...);
/// rx.write(..., optimism: rx.Optimism.awaitServer);
/// ```
library;

export 'src/rx/canonical.dart';
export 'src/rx/watch.dart';
export 'src/rx/write.dart';
