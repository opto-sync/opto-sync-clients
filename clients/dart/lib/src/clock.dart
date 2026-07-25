/// Hybrid Logical Clock for ordering optimistic writes.
///
/// The merge engine resolves conflicts by last-write-wins on `updatedAt`, which
/// is only correct if the timestamps are actually ordered. A device wall clock
/// is not: a device running fast wins every conflict forever, a clock corrected
/// backwards makes its own later edits vanish, and equal timestamps let arrival
/// order decide (so two replicas can diverge).
///
/// An HLC tracks physical time, never moves backwards, breaks ties with a
/// counter, and embeds a node id so no two nodes collide — giving a total order.
///
/// Wire format: `<13-digit millis>-<4-hex counter>-<node id>`, byte-identical to
/// the TypeScript and Rust clients so timestamps from any client order against
/// each other. Fixed width is load-bearing — the C core compares non-digit
/// strings lexicographically, so fixed width makes lexicographic order equal
/// chronological order.
library;

import 'dart:math';

const int _millisDigits = 13;
const int _maxCounter = 0xffff;

/// Decomposed HLC timestamp.
class HlcParts {
  final int millis;
  final int counter;
  final String nodeId;

  const HlcParts({required this.millis, required this.counter, required this.nodeId});

  @override
  bool operator ==(Object other) =>
      other is HlcParts &&
      other.millis == millis &&
      other.counter == counter &&
      other.nodeId == nodeId;

  @override
  int get hashCode => Object.hash(millis, counter, nodeId);

  @override
  String toString() => formatHlc(this);
}

String formatHlc(HlcParts parts) {
  final ms = parts.millis.toString().padLeft(_millisDigits, '0');
  final counter = parts.counter.toRadixString(16).padLeft(4, '0');
  return '$ms-$counter-${parts.nodeId}';
}

final RegExp _hlcPattern = RegExp(r'^(\d{13})-([0-9a-f]{4})-(.+)$');

/// Returns null for anything not produced by this format (a bare epoch number
/// or an ISO-8601 string from a legacy writer).
HlcParts? parseHlc(String timestamp) {
  final m = _hlcPattern.firstMatch(timestamp);
  if (m == null) return null;
  return HlcParts(
    millis: int.parse(m.group(1)!),
    counter: int.parse(m.group(2)!, radix: 16),
    nodeId: m.group(3)!,
  );
}

/// Total order over HLC strings. Lexicographic, because the format is fixed-width.
int compareHlc(String a, String b) => a.compareTo(b);

/// Generates a delimiter-free node id. Persist it: a client that regenerates
/// its node id on every launch loses consistent tie-breaking against its own
/// past writes.
String randomNodeId([int byteLength = 6]) {
  final rng = Random.secure();
  return List.generate(byteLength, (_) => rng.nextInt(256).toRadixString(16).padLeft(2, '0'))
      .join();
}

/// Compose a per-writer node id from a durable device id and a per-instance
/// suffix.
///
/// The suffix is essential and easy to miss: several writers can share one
/// durable store (two isolates over the same sqlite file, a background sync
/// worker alongside the UI), so they would read the same persisted device id
/// and the same clock state and issue *identical* timestamps — reintroducing
/// exactly the tie the node id exists to prevent.
///
/// Separator is `.` because `-` delimits the wire format.
String composeNodeId(String deviceId, [String? instanceSuffix]) =>
    '$deviceId.${instanceSuffix ?? randomNodeId(3)}';

/// How far ahead of local physical time an observed remote timestamp may be
/// before it is refused.
///
/// Without a bound, [HybridLogicalClock.observe] adopts any remote value, so
/// ONE client with a broken or hostile clock poisons every clock that syncs
/// with it — and every honest write then loses to the poisoned timestamp
/// forever. Reference implementations all bound this: jlongster/Actual uses
/// 60s, uhlc-rs defaults to 500ms.
const int defaultMaxDriftMs = 60000;

/// Thrown by [HybridLogicalClock.observe] when a remote timestamp is further
/// ahead of local physical time than the configured bound.
///
/// Refusing is deliberate: adopting the value would make every later local
/// write inherit the bad time, so the damage spreads to every peer that syncs
/// with this one. Callers should treat this as "that peer's clock is wrong",
/// log it, and keep the rest of the payload — the merge itself is unaffected.
class ClockDriftException implements Exception {
  /// The remote timestamp that was refused.
  final String remote;

  /// How far ahead of local physical time it was, in milliseconds.
  final int driftMs;

  /// The bound it exceeded.
  final int maxDriftMs;

  ClockDriftException(this.remote, this.driftMs, this.maxDriftMs);

  @override
  String toString() => 'ClockDriftException: remote timestamp $remote is '
      '${driftMs}ms ahead of local time (max ${maxDriftMs}ms); '
      'refusing to adopt it';
}

/// Where the clock's last state is kept so it survives a restart.
abstract class ClockPersistence {
  Future<String?> load();
  Future<void> save(String timestamp);
}

/// Non-durable persistence: the clock resets on restart. Fine for tests, not
/// for a device that must not reissue timestamps after a crash.
class NoClockPersistence implements ClockPersistence {
  const NoClockPersistence();

  @override
  Future<String?> load() async => null;

  @override
  Future<void> save(String timestamp) async {}
}

class HybridLogicalClock {
  final String nodeId;
  final int Function() _now;
  final ClockPersistence _persistence;
  int _millis = 0;
  int _counter = 0;

  HybridLogicalClock({
    required this.nodeId,
    int Function()? now,
    ClockPersistence persistence = const NoClockPersistence(),
  })  : _now = now ?? (() => DateTime.now().millisecondsSinceEpoch),
        // ignore: prefer_initializing_formals -- the field is private, the
        // parameter is public API, so an initializing formal is not possible.
        _persistence = persistence {
    if (nodeId.isEmpty) {
      throw ArgumentError.value(nodeId, 'nodeId', 'must not be empty');
    }
    if (nodeId.contains('-')) {
      // The wire format splits on '-', so a node id containing one would make
      // parsing ambiguous.
      throw ArgumentError.value(nodeId, 'nodeId', 'must not contain "-"');
    }
  }

  /// Restore the last issued timestamp so the clock cannot go backwards across
  /// a restart. Call once before issuing timestamps.
  Future<void> restore() async {
    final saved = await _persistence.load();
    if (saved == null) return;
    final parts = parseHlc(saved);
    if (parts == null) return;
    _millis = parts.millis;
    _counter = parts.counter;
  }

  HlcParts peek() => HlcParts(millis: _millis, counter: _counter, nodeId: nodeId);

  /// Issue the next timestamp: strictly greater than every timestamp this clock
  /// has issued or observed, even if the wall clock jumped backwards.
  Future<String> next() async {
    final physical = _now();
    if (physical > _millis) {
      _millis = physical;
      _counter = 0;
    } else {
      _counter += 1;
      if (_counter > _maxCounter) {
        _millis += 1;
        _counter = 0;
      }
    }
    final ts = formatHlc(peek());
    await _persistence.save(ts);
    return ts;
  }

  /// Advance past a timestamp observed from another node, so the next local
  /// write outranks anything already seen. Non-HLC values are ignored — their
  /// scale is not comparable and adopting one would corrupt the clock.
  Future<void> observe(String remoteTimestamp) async {
    final remote = parseHlc(remoteTimestamp);
    if (remote == null) return;
    if (remote.millis > _millis) {
      _millis = remote.millis;
      _counter = remote.counter;
    } else if (remote.millis == _millis && remote.counter > _counter) {
      _counter = remote.counter;
    } else {
      return;
    }
    await _persistence.save(formatHlc(peek()));
  }
}
