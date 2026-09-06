import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:opto_sync_state_flutter/opto_sync_state_flutter.dart';

void main() {
  testWidgets(
    'selector rebuilds only its slice and releases the subscription',
    (tester) async {
      final store = StateStore<({int count, bool busy}), String>(
        (count: 0, busy: false),
        (s, a) => a == 'add'
            ? (count: s.count + 1, busy: s.busy)
            : (count: s.count, busy: !s.busy),
      );
      final count = StoreListenable(store, (s) => s.count);
      var builds = 0;
      await tester.pumpWidget(
        MaterialApp(
          home: ValueListenableBuilder<int>(
            valueListenable: count,
            builder: (_, value, _) {
              builds += 1;
              return Text('Count: $value');
            },
          ),
        ),
      );
      expect(find.text('Count: 0'), findsOneWidget);
      store.dispatch('busy');
      await tester.pump();
      expect(builds, 1);
      store.dispatch('add');
      await tester.pump();
      expect(find.text('Count: 1'), findsOneWidget);
      expect(builds, 2);
      await tester.pumpWidget(const SizedBox());
      count.dispose();
      count.dispose();
      store.dispatch('add');
      expect(store.state.count, 2);
      expect(count.value, 1);
      store.dispose();
    },
  );

  test('caller equality is the only selection filter', () {
    final store = StateStore<int, int>(0, (_, a) => a);
    final count = StoreListenable(store, (s) => s, same: (_, _) => false);
    var calls = 0;
    count.addListener(() => calls += 1);
    store.dispatch(0);
    expect(calls, 1);
    count.dispose();
    store.dispose();
  });
}
