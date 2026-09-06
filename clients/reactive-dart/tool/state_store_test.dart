import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:opto_sync_reactive/state_store.dart';

typedef State = ({int count, String status});
typedef Action = Map<String, dynamic>;
const initial = (count: 0, status: 'idle');
State reduce(State s, Action a) => switch (a['type']) {
  'add' => (count: s.count + (a['value'] as int), status: s.status),
  'hydrate' => (count: a['value'] as int, status: s.status),
  'status' => (count: s.count, status: a['value'] as String),
  _ => throw StateError('unknown action'),
};
void check(bool condition, String message) {
  if (!condition) throw StateError(message);
}

void corpus() {
  final fixture =
      jsonDecode(
            File.fromUri(
              Platform.script.resolve(
                '../../../conformance/state-store/scenario.json',
              ),
            ).readAsStringSync(),
          )
          as Map<String, dynamic>;
  check(fixture['contract'] == 'opto.state-store.v1', 'contract');
  final store = StateStore<State, Action>(initial, reduce);
  final selections = <int>[];
  final stop = store.select((s) => s.count, selections.add);
  final effects = <String, StateEffect<Action>>{};
  for (final step in (fixture['steps'] as List).cast<Map<String, dynamic>>()) {
    switch (step['op']) {
      case 'dispatch':
        store.dispatch(step['action'] as Action);
      case 'begin':
        effects[step['id'] as String] = store.beginEffect(
          step['key'] as String,
        );
      case 'effect':
        check(
          effects[step['id']]!.dispatch(step['action'] as Action) ==
              step['accepted'],
          'effect: $step',
        );
      case 'close':
        effects[step['id']]!.close();
      case 'reset':
        store.reset(initial);
      case 'unsubscribe':
        stop();
        stop();
      case 'dispose':
        store.dispose();
      default:
        throw StateError('unknown step');
    }
    check(store.revision == step['revision'], 'revision: $step');
    if (step.containsKey('count')) {
      check(store.state.count == step['count'], 'count: $step');
    }
    if (step.containsKey('status')) {
      check(store.state.status == step['status'], 'status: $step');
    }
    if (step.containsKey('selections')) {
      check(jsonEncode(selections) == jsonEncode(step['selections']), 'select');
    }
  }
  expectError(() => store.dispatch({'type': 'add', 'value': 1}));
  expectError(() => store.reset(initial));
  expectError(() => store.beginEffect('late'));
  expectError(() => store.select((s) => s, (_) {}));
}

void expectError(void Function() action) {
  var failed = false;
  try {
    action();
  } on StateError {
    failed = true;
  }
  check(failed, 'expected StateError');
}

void failures() {
  final errors = <Object>[];
  final store = StateStore<State, Action>(
    initial,
    reduce,
    onObserverError: (e, _) => errors.add(e),
  );
  expectError(() => store.dispatch({'type': 'fail'}));
  check(store.revision == 0 && store.state == initial, 'atomic reducer');
  store.select((s) => s.count, (count) {
    if (count > 0) store.dispatch({'type': 'add', 'value': 100});
  });
  final good = <int>[];
  store.select((s) => s.count, good.add);
  store.dispatch({'type': 'add', 'value': 1});
  check(errors.length == 1 && good.join(',') == '0,1', 'observer isolation');
  expectError(
    () => store.select((s) => s.count, (_) => throw StateError('init')),
  );
  store.dispatch({'type': 'status', 'value': 'ready'});
  check(errors.length == 1, 'failed subscription leaked');
  final lists = <List<int>>[];
  store.select(
    (s) => [s.count],
    lists.add,
    same: (a, b) => a.single == b.single,
  );
  store.dispatch({'type': 'status', 'value': 'idle'});
  check(lists.length == 1, 'custom equality');
}

Future<void> projections() async {
  final store = StateStore<State, Action>(initial, reduce);
  Action hydrate(int value) => {'type': 'hydrate', 'value': value};
  final old = Completer<int>();
  final first = store.projectLocalView('view', () => old.future, hydrate);
  check(
    await store.projectLocalView('view', () async => 7, hydrate),
    'new projection',
  );
  old.complete(99);
  check(!await first && store.state.count == 7, 'out of order');
  final rotating = Completer<int>();
  final pending = store.projectLocalView(
    'view',
    () => rotating.future,
    hydrate,
  );
  store.reset(initial);
  rotating.complete(55);
  check(!await pending && store.state == initial, 'session fence');
  var failed = false;
  try {
    await store.projectLocalView<int>(
      'view',
      () async => throw StateError('disk'),
      hydrate,
    );
  } on StateError {
    failed = true;
  }
  check(failed && store.state == initial, 'read error');
  final disk = Completer<void>();
  final queue = <int>[];
  final effect = store.beginEffect('write');
  final write = () async {
    try {
      await disk.future;
      queue.add(1);
      return effect.dispatch(hydrate(queue.length));
    } finally {
      effect.close();
    }
  }();
  store.dispose();
  disk.complete();
  check(
    !await write && queue.single == 1,
    'dispose must not cancel durability',
  );
}

Future<void> main() async {
  corpus();
  failures();
  await projections();
  print(
    'State-store corpus, selectors, failures, effects and durability passed',
  );
}
