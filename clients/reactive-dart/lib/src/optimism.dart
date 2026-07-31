import 'dart:async';

import 'contracts.dart';

abstract interface class LocalDurableWrite<T, L> {
  Future<L> commitLocalAndQueue(T value);
  Future<void> commitAuthoritative(T value);
}

abstract interface class RemoteConfirmedWriter<T> {
  Future<T> write(T value);
}

abstract interface class ForegroundSyncCycle<S> {
  void hint();
  Future<S> syncNow();
}

sealed class OptimisticWriteResult<T, L, S> {
  const OptimisticWriteResult({required this.partition});
  final String partition;
}

final class RemoteConfirmedWrite<T, L, S>
    extends OptimisticWriteResult<T, L, S> {
  const RemoteConfirmedWrite({
    required super.partition,
    required this.authoritative,
  });

  final T authoritative;
}

final class LocalQueuedWrite<T, L, S> extends OptimisticWriteResult<T, L, S> {
  const LocalQueuedWrite({
    required super.partition,
    required this.localResult,
  });

  final L localResult;
}

final class LocalConfirmedWrite<T, L, S>
    extends OptimisticWriteResult<T, L, S> {
  const LocalConfirmedWrite({
    required super.partition,
    required this.localResult,
    required this.syncResult,
  });

  final L localResult;
  final S syncResult;
}

Future<OptimisticWriteResult<T, L, S>> writeWithOptimism<T, L, S>({
  required SyncOptimism strategy,
  required SyncSession session,
  required T value,
  required LocalDurableWrite<T, L> local,
  required RemoteConfirmedWriter<T> remote,
  required ForegroundSyncCycle<S> sync,
  FutureOr<void> Function()? wakeBackground,
}) async {
  final identity = requireAuthenticated(session);
  final partition = storagePartitionKey(identity);

  switch (strategy) {
    case SyncOptimism.remoteConfirmed:
      final authoritative = await remote.write(value);
      await local.commitAuthoritative(authoritative);
      return RemoteConfirmedWrite<T, L, S>(
        partition: partition,
        authoritative: authoritative,
      );
    case SyncOptimism.localDurable:
      final localResult = await local.commitLocalAndQueue(value);
      sync.hint();
      await wakeBackground?.call();
      return LocalQueuedWrite<T, L, S>(
        partition: partition,
        localResult: localResult,
      );
    case SyncOptimism.localThenRemote:
      final localResult = await local.commitLocalAndQueue(value);
      sync.hint();
      await wakeBackground?.call();
      final syncResult = await sync.syncNow();
      return LocalConfirmedWrite<T, L, S>(
        partition: partition,
        localResult: localResult,
        syncResult: syncResult,
      );
  }
}
