part of '../formal_itf_replay.dart';

Future<void> _assertProjection(
  _Adapter adapter,
  _DecodedState state,
  String context,
) async {
  final sequenceRow = await (adapter.db.select(adapter.db.meta)
        ..where((table) => table.key.equals(metaMutationSequenceKey)))
      .getSingleOrNull();
  final sequence = sequenceRow?.value ?? '0';
  _ensure(
    RegExp(r'^(?:0|[1-9]\d*)$').hasMatch(sequence),
    '$context: durable mutation sequence is invalid',
    expected: 'canonical decimal string',
    actual: sequence,
  );
  final actualNextId = BigInt.parse(sequence) + BigInt.one;
  final expectedNextId = _stateBigInt(state, 'next_id');
  _ensure(
    actualNextId == expectedNextId,
    '$context: next mutation id differs from the model',
    expected: expectedNextId.toString(),
    actual: actualNextId.toString(),
  );

  final expectedCheckpoint = _stateBigInt(
    state,
    'local_checkpoint',
  ).toString();
  final actualCheckpoint = await adapter.client.pullCheckpoint();
  _ensure(
    actualCheckpoint == expectedCheckpoint,
    '$context: pull checkpoint differs from the model',
    expected: expectedCheckpoint,
    actual: actualCheckpoint,
  );

  final pendingRows = await adapter.client.pendingMutations();
  final allRows = await (adapter.db.select(adapter.db.localMutations)
        ..orderBy([(table) => OrderingTerm.asc(table.id)]))
      .get();
  final actualPending = pendingRows.map((row) {
    _ensure(
      row.mutationId != null,
      '$context: pending row lacks a mutation id',
      expected: 'mutation id',
      actual: null,
    );
    return BigInt.parse(row.mutationId!).toString();
  }).toSet();
  final actualConfirmed = allRows
      .where((row) => row.syncStatus == SyncStatus.synced)
      .map((row) {
        _ensure(
          row.mutationId != null,
          '$context: confirmed row lacks a mutation id',
          expected: 'mutation id',
          actual: null,
        );
        return BigInt.parse(row.mutationId!).toString();
      })
      .toSet();
  final actualAllocated = allRows.map((row) {
    _ensure(
      row.mutationId != null,
      '$context: allocated row lacks a mutation id',
      expected: 'mutation id',
      actual: null,
    );
    return BigInt.parse(row.mutationId!).toString();
  }).toSet();

  _ensureIdSetsEqual(
    actualPending,
    _stateSet(state, 'pending'),
    context,
    'pending mutation ids',
  );
  _ensureIdSetsEqual(
    actualConfirmed,
    _stateSet(state, 'acknowledged'),
    context,
    'confirmed mutation ids',
  );
  _ensureIdSetsEqual(
    actualAllocated,
    _allocatedIds(expectedNextId),
    context,
    'allocated mutation ids',
  );

  final inFlight = _stateBigInt(state, 'in_flight');
  if (adapter.request == null) {
    _ensure(
      inFlight == BigInt.zero,
      '$context: model has an in-flight request but adapter has none',
      expected: inFlight.toString(),
      actual: null,
    );
  } else {
    _ensure(
      inFlight > BigInt.zero,
      '$context: adapter has a request but model has no in-flight id',
      expected: 'positive id',
      actual: inFlight.toString(),
    );
    _ensure(
      _requestMutationId(adapter.request) == inFlight,
      '$context: in-flight request identity differs from the model',
      expected: inFlight.toString(),
      actual: _requestMutationId(adapter.request).toString(),
    );
  }

  final responsePresent = _stateBool(state, 'response_present');
  _ensure(
    (adapter.response != null) == responsePresent,
    '$context: response presence differs from the model',
    expected: responsePresent,
    actual: adapter.response != null,
  );
  if (adapter.response != null) {
    final results = _array(adapter.response!['results'], 'adapter response results');
    _ensure(
      results.isNotEmpty,
      '$context: adapter response has no mutation result',
      expected: 'one result',
      actual: results,
    );
    final result = _object(results.first, 'adapter response result');
    _ensure(
      adapter.response!['lastMutationId'] ==
          _stateBigInt(state, 'response_watermark').toString(),
      '$context: response watermark differs from the model',
      expected: _stateBigInt(state, 'response_watermark').toString(),
      actual: adapter.response!['lastMutationId'],
    );
    _ensure(
      adapter.response!['checkpoint'] ==
          _stateBigInt(state, 'response_checkpoint').toString(),
      '$context: response checkpoint differs from the model',
      expected: _stateBigInt(state, 'response_checkpoint').toString(),
      actual: adapter.response!['checkpoint'],
    );
    _ensure(
      result['mutationId'] ==
          _stateBigInt(state, 'response_mutation_id').toString(),
      '$context: response mutation id differs from the model',
      expected: _stateBigInt(state, 'response_mutation_id').toString(),
      actual: result['mutationId'],
    );
    _ensure(
      adapter.responseValid ==
          _stateBool(state, 'response_valid_for_in_flight'),
      '$context: response validity differs from the model',
      expected: _stateBool(state, 'response_valid_for_in_flight'),
      actual: adapter.responseValid,
    );
  } else {
    _ensure(
      !adapter.responseValid,
      '$context: absent response cannot be marked valid',
      expected: false,
      actual: adapter.responseValid,
    );
  }

  final replacing = _stateTag(state, 'reset_phase') == 'Replacing';
  _ensure(
    adapter.replacingSnapshot == replacing,
    '$context: reset phase differs from the model',
    expected: replacing,
    actual: adapter.replacingSnapshot,
  );
}
