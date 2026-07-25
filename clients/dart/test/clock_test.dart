import 'package:opto_sync_client/opto_sync_client.dart';
import 'package:test/test.dart';

/// In-memory persistence standing in for the device store.
class MemoryClockPersistence implements ClockPersistence {
  String? value;
  @override
  Future<String?> load() async => value;
  @override
  Future<void> save(String timestamp) async => value = timestamp;
}

void main() {
  group('HybridLogicalClock', () {
    test('is monotonic within a single millisecond', () async {
      final clock = HybridLogicalClock(nodeId: 'aaaa', now: () => 1721822400000);
      final a = await clock.next();
      final b = await clock.next();
      expect(compareHlc(a, b), lessThan(0), reason: '$a must precede $b');
      expect(parseHlc(a)!.counter, 0);
      expect(parseHlc(b)!.counter, 1);
    });

    test('survives a wall clock that jumps backwards', () async {
      // The real failure: an NTP correction would otherwise make this device's
      // later edits lose to its own earlier ones and silently vanish.
      var wall = 1721822400000;
      final clock = HybridLogicalClock(nodeId: 'aaaa', now: () => wall);
      final before = await clock.next();
      wall = 1721822100000; // five minutes into the past
      final after = await clock.next();
      expect(compareHlc(after, before), greaterThan(0),
          reason: '$after must outrank $before');
    });

    test('observe() advances past a remote timestamp', () async {
      final clock = HybridLogicalClock(nodeId: 'aaaa', now: () => 1000000000000);
      const remote = '1721822400000-00ff-bbbb';
      await clock.observe(remote);
      final next = await clock.next();
      expect(compareHlc(next, remote), greaterThan(0));
    });

    test('observe() ignores incomparable timestamps', () async {
      final clock = HybridLogicalClock(nodeId: 'aaaa', now: () => 1721822400000);
      await clock.observe('2026-07-25T00:00:00Z');
      await clock.observe('1721822400000');
      expect(clock.peek().millis, 0,
          reason: 'must not adopt a scale it cannot compare');
    });

    test('two nodes never tie', () async {
      final a = HybridLogicalClock(nodeId: 'aaaa', now: () => 1721822400000);
      final b = HybridLogicalClock(nodeId: 'bbbb', now: () => 1721822400000);
      expect(await a.next(), isNot(equals(await b.next())));
    });

    test('persistence keeps the clock monotonic across a restart', () async {
      final store = MemoryClockPersistence();
      var wall = 1721822400000;
      final first =
          HybridLogicalClock(nodeId: 'aaaa', now: () => wall, persistence: store);
      await first.restore();
      final last = await first.next();

      wall = 1721800000000; // restart with the clock moved backwards
      final reloaded =
          HybridLogicalClock(nodeId: 'aaaa', now: () => wall, persistence: store);
      await reloaded.restore();
      expect(compareHlc(await reloaded.next(), last), greaterThan(0));
    });

    test('rejects a node id containing the delimiter', () {
      expect(() => HybridLogicalClock(nodeId: 'has-dash'), throwsArgumentError);
      expect(() => HybridLogicalClock(nodeId: ''), throwsArgumentError);
    });

    test('format is byte-identical to the TypeScript and Rust clients', () {
      // Cross-client parity: this exact string is asserted in the other two
      // clients' suites. If one drifts, their timestamps stop ordering.
      const parts = HlcParts(millis: 1721822400000, counter: 255, nodeId: '9f3a2b');
      expect(formatHlc(parts), '1721822400000-00ff-9f3a2b');
      expect(parseHlc('1721822400000-00ff-9f3a2b'), parts);
    });

    test('randomNodeId is delimiter-free and collision-resistant', () {
      final ids = {for (var i = 0; i < 500; i++) randomNodeId()};
      expect(ids.length, 500);
      expect(ids.every((id) => !id.contains('-')), isTrue);
    });
  });
}
