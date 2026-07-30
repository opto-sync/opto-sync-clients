part of '../formal_itf_replay.dart';

final class _PassthroughSyncer implements ISyncer {
  const _PassthroughSyncer();

  @override
  String merge(String base, String incoming) => incoming;
}

final class _Adapter {
  _Adapter._({required this.directory, required this.databaseFile});

  static const _syncer = _PassthroughSyncer();

  final Directory directory;
  final File databaseFile;
  late OptoSyncDatabase db;
  late OptoSyncClient client;
  Map<String, dynamic>? request;
  final Map<String, Map<String, dynamic>> sentRequests =
      <String, Map<String, dynamic>>{};
  Map<String, dynamic>? response;
  bool responseValid = false;
  bool replacingSnapshot = false;

  static Future<_Adapter> create(String tracePath) async {
    final safeName = tracePath
        .split(Platform.pathSeparator)
        .last
        .replaceAll(RegExp(r'[^A-Za-z0-9_.-]'), '-');
    final directory = await Directory.systemTemp.createTemp(
      'opto-sync-formal-$safeName-',
    );
    final adapter = _Adapter._(
      directory: directory,
      databaseFile: File(
        '${directory.path}${Platform.pathSeparator}queue.sqlite',
      ),
    );
    adapter._open();
    return adapter;
  }

  void _open() {
    db = OptoSyncDatabase(NativeDatabase(databaseFile));
    client = OptoSyncClient(db: db, syncer: _syncer, stampUpdatedAt: false);
  }

  Future<void> reopen() async {
    await db.close();
    _open();
  }

  Future<void> dispose() async {
    await db.close();
    if (await directory.exists()) {
      await directory.delete(recursive: true);
    }
  }
}

Future<Map<String, dynamic>> _responseFromState(
  _Adapter adapter,
  _DecodedState state,
  String status, {
  String? originalStatus,
}) async {
  final mutationId = _stateBigInt(state, 'response_mutation_id').toString();
  final checkpoint = _stateBigInt(state, 'response_checkpoint').toString();
  final hasAppliedEffect = status == 'applied' || originalStatus == 'applied';
  final clientId =
      adapter.request?['clientId'] ?? await adapter.client.clientId();
  final result = <String, dynamic>{
    'mutationId': mutationId,
    'status': status,
    'checkpoint': checkpoint,
  };
  if (originalStatus != null) {
    result['originalStatus'] = originalStatus;
  }
  if (hasAppliedEffect) {
    result['revision'] = mutationId;
  }
  return <String, dynamic>{
    'protocolVersion': 1,
    'clientId': clientId,
    'lastMutationId': _stateBigInt(state, 'response_watermark').toString(),
    'checkpoint': checkpoint,
    'results': <Map<String, dynamic>>[result],
  };
}

Future<Map<String, Object?>> _databaseSnapshot(_Adapter adapter) async {
  final mutations = await (adapter.db.select(
    adapter.db.localMutations,
  )..orderBy([(table) => OrderingTerm.asc(table.id)])).get();
  final metadata = await (adapter.db.select(
    adapter.db.meta,
  )..orderBy([(table) => OrderingTerm.asc(table.key)])).get();
  return <String, Object?>{
    'mutations': mutations
        .map(
          (row) => <String, Object?>{
            'id': row.id,
            'tableName': row.targetTable,
            'recordId': row.recordId,
            'jsonPayload': row.jsonPayload,
            'createdAt': row.createdAt.toUtc().toIso8601String(),
            'syncStatus': row.syncStatus,
            'clientId': row.clientId,
            'mutationId': row.mutationId,
            'operation': row.operation,
            'baseRevision': row.baseRevision,
            'resurrect': row.resurrect,
            'attempts': row.attempts,
            'lastError': row.lastError,
          },
        )
        .toList(growable: false),
    'metadata': metadata
        .map((row) => <String, Object?>{'key': row.key, 'value': row.value})
        .toList(growable: false),
  };
}

Future<_Adapter> _applyAction(
  _Adapter? adapter,
  _DecodedState state,
  String tracePath,
) async {
  if (state.action == 'init') {
    await adapter?.dispose();
    return _Adapter.create(tracePath);
  }

  _ensure(
    adapter != null,
    'action `${state.action}` occurred before init',
    expected: 'initialized adapter',
    actual: null,
  );
  final current = adapter!;

  switch (state.action) {
    case 'idle':
    case 'compact':
      break;

    case 'enqueue':
      {
        final expectedId = _stateBigInt(state, 'next_id') - BigInt.one;
        _ensure(
          expectedId > BigInt.zero,
          'enqueue produced an invalid next id',
          expected: 'positive id',
          actual: expectedId.toString(),
        );
        final rowId = await current.client.queueMutation(
          'docs',
          'record-$expectedId',
          <String, dynamic>{
            'id': 'record-$expectedId',
            'value': expectedId.toString(),
          },
        );
        final row = await (current.db.select(
          current.db.localMutations,
        )..where((table) => table.id.equals(rowId))).getSingleOrNull();
        _ensure(
          row != null,
          'queueMutation returned a missing row',
          expected: rowId,
          actual: null,
        );
        _ensure(
          row!.mutationId == expectedId.toString(),
          'enqueue allocated the wrong mutation id',
          expected: expectedId.toString(),
          actual: row.mutationId,
        );
        await current.reopen();
        break;
      }

    case 'send':
      {
        _ensure(
          current.request == null,
          'request already in flight',
          expected: null,
          actual: current.request,
        );
        _ensure(
          current.response == null,
          'response already present',
          expected: null,
          actual: current.response,
        );
        final expectedId = _pickedId(state);
        final request = await current.client.protocolPushRequest(limit: 1);
        _ensure(
          _requestMutationId(request) == expectedId,
          'sent mutation does not match the model id',
          expected: expectedId.toString(),
          actual: _requestMutationId(request).toString(),
        );
        final requestKey = expectedId.toString();
        final previous = current.sentRequests[requestKey];
        if (previous == null) {
          current.sentRequests[requestKey] = _jsonClone(request);
        } else {
          _ensure(
            _deepEqual(request, previous),
            'retry changed its immutable request envelope',
            expected: previous,
            actual: request,
          );
        }
        current.request = request;
        break;
      }

    case 'apply_new':
    case 'reject_new':
      {
        _ensure(
          current.response == null,
          'response already present',
          expected: null,
          actual: current.response,
        );
        _ensure(
          _requestMutationId(current.request) == _pickedId(state),
          '${state.action} id does not match the in-flight request',
          expected: _pickedId(state).toString(),
          actual: _requestMutationId(current.request).toString(),
        );
        current.response = await _responseFromState(
          current,
          state,
          state.action == 'apply_new' ? 'applied' : 'rejected',
        );
        current.responseValid = true;
        break;
      }

    case 'reply_duplicate':
      {
        _ensure(
          current.response == null,
          'response already present',
          expected: null,
          actual: current.response,
        );
        final id = _pickedId(state);
        _ensure(
          _requestMutationId(current.request) == id,
          'duplicate reply id does not match the in-flight request',
          expected: id.toString(),
          actual: _requestMutationId(current.request).toString(),
        );
        final idString = id.toString();
        final originalStatus = _stateSet(state, 'applied').contains(idString)
            ? 'applied'
            : _stateSet(state, 'rejected').contains(idString)
            ? 'rejected'
            : null;
        _ensure(
          originalStatus != null,
          'duplicate reply has no durable original outcome',
          expected: 'applied or rejected',
          actual: null,
        );
        current.response = await _responseFromState(
          current,
          state,
          'duplicate',
          originalStatus: originalStatus,
        );
        current.responseValid = true;
        break;
      }

    case 'inject_mismatched_response':
      {
        _ensure(
          current.response == null,
          'response already present',
          expected: null,
          actual: current.response,
        );
        _ensure(
          current.request != null,
          'mismatched response without an in-flight request',
          expected: 'request',
          actual: null,
        );
        final response = await _responseFromState(current, state, 'applied');
        final before = await _databaseSnapshot(current);
        Object? rejection;
        try {
          await current.client.acknowledgePush(response, current.request!);
        } catch (error) {
          rejection = error;
        }
        _ensure(
          rejection is FormatException &&
              rejection.message ==
                  'push acknowledgement does not match the sent batch',
          'malformed response returned an unexpected result',
          expected:
              'FormatException(push acknowledgement does not match the sent batch)',
          actual: rejection?.toString(),
        );
        final after = await _databaseSnapshot(current);
        _ensure(
          _deepEqual(after, before),
          'rejecting a malformed response mutated Drift/SQLite state',
          expected: before,
          actual: after,
        );
        current.response = response;
        current.responseValid = false;
        break;
      }

    case 'lose_committed_response':
    case 'lose_uncommitted_request':
      {
        current.request = null;
        current.response = null;
        current.responseValid = false;
        await current.reopen();
        break;
      }

    case 'discard_malformed_response':
      {
        _ensure(
          current.response != null && !current.responseValid,
          'discard_malformed_response requires a rejected response',
          expected: 'invalid response',
          actual: current.response,
        );
        current.request = null;
        current.response = null;
        current.responseValid = false;
        break;
      }

    case 'acknowledge':
      {
        _ensure(
          current.responseValid,
          'cannot acknowledge an invalid response',
          expected: true,
          actual: current.responseValid,
        );
        _ensure(
          current.response != null && current.request != null,
          'acknowledge requires a response and in-flight request',
          expected: 'request and response',
          actual: <String, bool>{
            'request': current.request != null,
            'response': current.response != null,
          },
        );
        _ensure(
          _requestMutationId(current.request) == _pickedId(state),
          'acknowledgement id does not match the in-flight request',
          expected: _pickedId(state).toString(),
          actual: _requestMutationId(current.request).toString(),
        );
        final changed = await current.client.acknowledgePush(
          current.response!,
          current.request!,
        );
        _ensure(
          changed == 1,
          'acknowledgement changed the wrong number of rows',
          expected: 1,
          actual: changed,
        );
        current.request = null;
        current.response = null;
        current.responseValid = false;
        await current.reopen();
        break;
      }

    case 'pull':
      {
        await current.client.setPullCheckpoint(
          _stateBigInt(state, 'local_checkpoint').toString(),
        );
        await current.reopen();
        break;
      }

    case 'begin_reset':
      {
        _ensure(
          !current.replacingSnapshot,
          'snapshot replacement already active',
          expected: false,
          actual: current.replacingSnapshot,
        );
        current.replacingSnapshot = true;
        await current.reopen();
        break;
      }

    case 'crash_during_reset':
      {
        _ensure(
          current.replacingSnapshot,
          'crash_during_reset without an active replacement',
          expected: true,
          actual: current.replacingSnapshot,
        );
        final snapshot = <String, dynamic>{
          'protocolVersion': 1,
          'checkpoint': _stateBigInt(state, 'server_checkpoint').toString(),
          'records': <Map<String, dynamic>>[],
        };
        final before = await _databaseSnapshot(current);
        var replacementCalled = false;
        Object? replacementError;
        try {
          await current.client.installSnapshot(snapshot, (records) async {
            replacementCalled = true;
            _ensure(
              records.isEmpty,
              'model snapshot must contain no records',
              expected: <Object?>[],
              actual: records,
            );
            throw StateError('simulated snapshot replacement crash');
          });
        } catch (error) {
          replacementError = error;
        }
        _ensure(
          replacementCalled,
          'failed snapshot installation skipped authoritative replacement',
          expected: true,
          actual: replacementCalled,
        );
        _ensure(
          replacementError is StateError &&
              replacementError.message ==
                  'simulated snapshot replacement crash',
          'snapshot replacement returned an unexpected error',
          expected: 'StateError(simulated snapshot replacement crash)',
          actual: replacementError?.toString(),
        );
        final after = await _databaseSnapshot(current);
        _ensure(
          _deepEqual(after, before),
          'failed snapshot replacement mutated Drift/SQLite state',
          expected: before,
          actual: after,
        );
        current.replacingSnapshot = false;
        await current.reopen();
        break;
      }

    case 'finish_reset':
      {
        _ensure(
          current.replacingSnapshot,
          'finish_reset without an active replacement',
          expected: true,
          actual: current.replacingSnapshot,
        );
        var replacementCalled = false;
        await current.client.installSnapshot(
          <String, dynamic>{
            'protocolVersion': 1,
            'checkpoint': _stateBigInt(state, 'server_checkpoint').toString(),
            'records': <Map<String, dynamic>>[],
          },
          (records) async {
            replacementCalled = true;
            _ensure(
              records.isEmpty,
              'model snapshot must contain no records',
              expected: <Object?>[],
              actual: records,
            );
          },
        );
        _ensure(
          replacementCalled,
          'successful snapshot installation skipped authoritative replacement',
          expected: true,
          actual: replacementCalled,
        );
        current.replacingSnapshot = false;
        await current.reopen();
        break;
      }

    default:
      _fail(
        'unsupported model action `${state.action}`',
        expected: _requiredActions,
        actual: state.action,
      );
  }

  return current;
}
