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
      final clock = HybridLogicalClock(
        nodeId: 'aaaa',
        now: () => 1721822400000,
      );
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
      expect(
        compareHlc(after, before),
        greaterThan(0),
        reason: '$after must outrank $before',
      );
    });

    test('observe() advances past a remote timestamp', () async {
      final clock = HybridLogicalClock(
        nodeId: 'aaaa',
        now: () => 1721822400000,
      );
      // 10s ahead: ordinary skew, well inside the drift bound.
      const remote = '1721822410000-00ff-bbbb';
      await clock.observe(remote);
      final next = await clock.next();
      expect(compareHlc(next, remote), greaterThan(0));
    });

    test(
      'observe() refuses a timestamp far in the future (bounded trust)',
      () async {
        // Without a bound, ONE client with a broken or hostile clock poisons
        // every clock that syncs with it, and every honest write then loses to
        // the poisoned timestamp forever.
        const wall = 1721822400000;
        final clock = HybridLogicalClock(nodeId: 'aaaa', now: () => wall);

        final poisoned = '${wall + defaultMaxDriftMs + 60000}-0000-evil';
        await expectLater(
          clock.observe(poisoned),
          throwsA(isA<ClockDriftException>()),
        );
        expect(
          clock.peek().millis,
          0,
          reason: 'a refused timestamp must not be adopted',
        );

        // Within the bound is still adopted — ordinary skew must not break sync.
        await clock.observe('${wall + 5000}-0000-bbbb');
        expect(clock.peek().millis, wall + 5000);
      },
    );

    test('observe() accepts a remote clock that is behind ours', () async {
      // Only future skew poisons the order; a peer running slow is ordinary.
      final clock = HybridLogicalClock(
        nodeId: 'aaaa',
        now: () => 1721822400000,
      );
      await clock.observe('1000000000000-0001-bbbb');
      expect(clock.peek().millis, 1000000000000);
    });

    test('a refused timestamp is not persisted', () async {
      final store = MemoryClockPersistence();
      const wall = 1721822400000;
      final clock = HybridLogicalClock(
        nodeId: 'aaaa',
        now: () => wall,
        persistence: store,
      );
      await expectLater(
        clock.observe('${wall + defaultMaxDriftMs + 1}-0000-evil'),
        throwsA(isA<ClockDriftException>()),
      );
      expect(
        store.value,
        isNull,
        reason:
            'persisting it would survive a restart and poison the clock '
            'permanently',
      );
    });

    test(
      'composeNodeId separates with "." and gives each instance its own id',
      () {
        // '-' delimits the wire format, so composing with it would make parseHlc
        // ambiguous. The per-instance suffix is what stops two writers sharing
        // one durable store from issuing identical timestamps.
        expect(composeNodeId('device1', 't2'), 'device1.t2');

        final a = composeNodeId('device1');
        final b = composeNodeId('device1');
        expect(a, isNot(equals(b)));
        expect(a.contains('-'), isFalse);
        expect(parseHlc('1721822400000-0000-$a')?.nodeId, a);
      },
    );

    test('observe() ignores incomparable timestamps', () async {
      final clock = HybridLogicalClock(
        nodeId: 'aaaa',
        now: () => 1721822400000,
      );
      await clock.observe('2026-07-25T00:00:00Z');
      await clock.observe('1721822400000');
      expect(
        clock.peek().millis,
        0,
        reason: 'must not adopt a scale it cannot compare',
      );
    });

    test('two nodes never tie', () async {
      final a = HybridLogicalClock(nodeId: 'aaaa', now: () => 1721822400000);
      final b = HybridLogicalClock(nodeId: 'bbbb', now: () => 1721822400000);
      expect(await a.next(), isNot(equals(await b.next())));
    });

    test('persistence keeps the clock monotonic across a restart', () async {
      final store = MemoryClockPersistence();
      var wall = 1721822400000;
      final first = HybridLogicalClock(
        nodeId: 'aaaa',
        now: () => wall,
        persistence: store,
      );
      await first.restore();
      final last = await first.next();

      wall = 1721800000000; // restart with the clock moved backwards
      final reloaded = HybridLogicalClock(
        nodeId: 'aaaa',
        now: () => wall,
        persistence: store,
      );
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
      const parts = HlcParts(
        millis: 1721822400000,
        counter: 255,
        nodeId: '9f3a2b',
      );
      expect(formatHlc(parts), '1721822400000-00ff-9f3a2b');
      expect(parseHlc('1721822400000-00ff-9f3a2b'), parts);
    });

    test('format and parse reject noncanonical cross-runtime values', () {
      for (final parts in [
        const HlcParts(millis: -1, counter: 0, nodeId: 'node'),
        const HlcParts(millis: 10000000000000, counter: 0, nodeId: 'node'),
        const HlcParts(millis: 1721822400000, counter: -1, nodeId: 'node'),
        const HlcParts(millis: 1721822400000, counter: 65536, nodeId: 'node'),
        const HlcParts(millis: 1721822400000, counter: 0, nodeId: ''),
        const HlcParts(millis: 1721822400000, counter: 0, nodeId: 'has-dash'),
      ]) {
        expect(() => formatHlc(parts), throwsA(anything));
      }
      expect(parseHlc('1721822400000-00FF-node'), isNull);
      expect(parseHlc('1721822400000-00ff-has-dash'), isNull);
    });

    test('randomNodeId is delimiter-free and collision-resistant', () {
      final ids = {for (var i = 0; i < 500; i++) randomNodeId()};
      expect(ids.length, 500);
      expect(ids.every((id) => !id.contains('-')), isTrue);
    });
  });
}
