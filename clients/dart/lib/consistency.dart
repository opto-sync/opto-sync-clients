/// Explicit consistency modes, frozen mutation intent, and deterministic
/// local-plus-remote read reconciliation.
///
/// ```dart
/// import 'package:opto_sync_client/consistency.dart' as consistency;
/// final policy = consistency.canonicalizeConsistencyPolicy('queued-local-first');
/// ```
library;

export 'src/consistency.dart';
