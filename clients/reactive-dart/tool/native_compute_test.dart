import 'dart:isolate';
import 'package:opto_sync_reactive/native_compute.dart';

String compute(int input) => '${Isolate.current.debugName}:$input';
int fail(int _) => throw StateError('payload must not escape');

Future<void> expectFailure(
  Future<Object?> future,
  NativeComputeFailure code,
) async {
  try {
    await future;
  } on NativeComputeException catch (e) {
    if (e.code != code) throw StateError('wrong failure: $e');
    return;
  }
  throw StateError('expected $code');
}

Future<void> main() async {
  final executor = NativeComputeExecutor(size: 2, maxPending: 3);
  final jobs = [
    executor.run(compute, 1),
    executor.run(compute, 2),
    executor.run(compute, 3),
  ];
  await expectFailure(executor.run(compute, 4), NativeComputeFailure.queueFull);
  final results = await Future.wait(jobs);
  for (var i = 0; i < results.length; i++) {
    if (!results[i].endsWith(':${i + 1}') ||
        results[i].startsWith('${Isolate.current.debugName}:')) {
      throw StateError('computation did not run in its own isolate: $results');
    }
  }
  await expectFailure(executor.run(fail, 0), NativeComputeFailure.taskFailed);
  final pending = [
    executor.run(compute, 5),
    executor.run(compute, 6),
    executor.run(compute, 7),
  ];
  final outcomes = pending
      .map((f) => expectFailure(f, NativeComputeFailure.disposed))
      .toList();
  executor.dispose();
  executor.dispose();
  await Future.wait(outcomes);
  await expectFailure(executor.run(compute, 8), NativeComputeFailure.disposed);
  print(
    'Native isolates: off-main execution, capacity, failures and disposal passed',
  );
}
